"""Paper trading en conditions réelles (§10, phase 7).

Même moteur de risque, mêmes coûts, même logique de décision que le backtest :
c'est la condition pour que la comparaison live / backtest ait un sens. Seule
la source de prix change (flux OKX en direct au lieu du cache Parquet).

Boucle, à chaque clôture de bougie du timeframe d'exécution :

1. téléchargement incrémental des dernières bougies (et du funding réel) ;
2. gestion des positions ouvertes sur la bougie qui vient de se clôturer :
   liquidation (mark price) > stop > take profit > durée maximale ;
3. règlements de funding tombant dans la bougie ;
4. tick du moteur de risque (invariants, coupe-circuits, verrou de profit) ;
5. décision de la stratégie sur la clôture, exécutée à l'ouverture de la
   bougie suivante — exactement comme en backtest ;
6. persistance de l'état sur disque (le processus peut redémarrer sans perdre
   ses positions ni ses haltes).

Aucun ordre réel n'est envoyé : ce module simule les fills sur des prix réels.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..backtest.portfolio import Portfolio, Position
from ..config import Config, resolve_path
from ..data.download import Downloader
from ..data.loader import MarketData, _prepare
from ..data.store import ParquetStore
from ..execution.costs import CostModel, FundingModel
from ..execution.simulator import ExecutionSimulator, Order
from ..features.pipeline import effective_warmup
from ..risk.engine import RiskEngine
from ..strategies.composite import RoutedMultiFamilyStrategy
from ..utils import ensure_dir, get_logger, timeframe_to_ms, timeframe_to_timedelta, to_utc

log = get_logger("live.paper")


@dataclass
class PaperState:
    """État sérialisable du compte papier."""

    started_at: str
    last_bar_ts: str | None = None
    cash: float = 0.0
    equity: float = 0.0
    positions: list[dict[str, Any]] = field(default_factory=list)
    trades: list[dict[str, Any]] = field(default_factory=list)
    risk_events: list[dict[str, Any]] = field(default_factory=list)
    pending_orders: list[dict[str, Any]] = field(default_factory=list)
    hwm_global: float = 0.0
    killed: bool = False
    bars_processed: int = 0

    def save(self, path: Path) -> None:
        ensure_dir(path.parent)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2, default=str), encoding="utf-8")
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> "PaperState | None":
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(**data)


class PaperTrader:
    def __init__(self, cfg: Config, symbols: list[str] | None = None, state_path: str | Path | None = None):
        self.cfg = cfg
        self.symbols = symbols or list(cfg.get_path("universe.symbols"))
        self.exec_tf = str(cfg.get_path("data.execution_timeframe"))
        self.exec_ms = timeframe_to_ms(self.exec_tf)
        self.store = ParquetStore(resolve_path(cfg, cfg.get_path("data.store_path")))
        self.downloader = Downloader(cfg)
        self.state_path = Path(state_path or resolve_path(cfg, cfg.get_path("paper.state_path"))) / "state.json"

        self.risk = RiskEngine(cfg)
        self.portfolio = Portfolio(self.risk.initial_equity)
        self.costs = CostModel(cfg)
        self.funding = FundingModel(cfg)
        self.sim = ExecutionSimulator(cfg, cost_model=self.costs, funding_model=self.funding)
        self.state = PaperState(started_at=str(pd.Timestamp.now("UTC")), cash=self.portfolio.cash,
                                equity=self.portfolio.initial_equity, hwm_global=self.portfolio.initial_equity)
        self._pending: list[Order] = []
        self._restore()

    # ------------------------------------------------------------------ état
    def _restore(self) -> None:
        saved = PaperState.load(self.state_path)
        if saved is None:
            log.info("Nouveau compte papier : %.2f USDT", self.portfolio.initial_equity)
            return
        self.state = saved
        self.portfolio.cash = float(saved.cash)
        self.portfolio.trades = []
        for p in saved.positions:
            pos = Position(
                symbol=p["symbol"], side=p["side"], quantity=float(p["quantity"]),
                entry_price=float(p["entry_price"]), margin=float(p["margin"]),
                leverage=float(p["leverage"]), stop_loss=float(p["stop_loss"]),
                take_profit=float(p["take_profit"]) if p.get("take_profit") else None,
                liquidation_price=float(p["liquidation_price"]),
                opened_at=to_utc(p["opened_at"]), risk_amount=float(p.get("risk_amount", 0.0)),
                regime=p.get("regime", ""), families=p.get("families", ""),
            )
            self.portfolio.positions[pos.symbol] = pos
        self.risk.equity = float(saved.equity)
        self.risk.hwm_global = float(saved.hwm_global)
        self.risk.killed = bool(saved.killed)
        log.info("État repris : %d positions, equity %.2f, %d bougies traitées",
                 len(self.portfolio.positions), saved.equity, saved.bars_processed)

    def _persist(self, equity: float, last_ts: pd.Timestamp) -> None:
        self.state.cash = self.portfolio.cash
        self.state.equity = equity
        self.state.hwm_global = self.risk.hwm_global
        self.state.killed = self.risk.killed
        self.state.last_bar_ts = str(last_ts)
        self.state.positions = [
            {
                "symbol": p.symbol, "side": p.side, "quantity": p.quantity,
                "entry_price": p.entry_price, "margin": p.margin, "leverage": p.leverage,
                "stop_loss": p.stop_loss, "take_profit": p.take_profit,
                "liquidation_price": p.liquidation_price, "opened_at": str(p.opened_at),
                "risk_amount": p.risk_amount, "regime": p.regime, "families": p.families,
            }
            for p in self.portfolio.positions.values()
        ]
        self.state.trades = [
            {k: (str(v) if isinstance(v, pd.Timestamp) else v) for k, v in t.__dict__.items()}
            for t in self.portfolio.trades
        ]
        self.state.risk_events = [
            {"ts": str(e.ts), "kind": e.kind, "scope": e.scope, "reason": e.reason, "equity": e.equity}
            for e in self.risk.events
        ]
        self.state.pending_orders = [
            {"symbol": o.symbol, "side": o.side, "intent": o.intent,
             "stop_loss": o.stop_loss, "take_profit": o.take_profit, "meta": o.meta}
            for o in self._pending
        ]
        self.state.save(self.state_path)

    # ------------------------------------------------------------- données
    def refresh_data(self) -> MarketData:
        """Complète le cache avec les dernières bougies closes puis le charge."""
        timeframes = list(self.cfg.get_path("data.signal_timeframes"))
        if self.exec_tf not in timeframes:
            timeframes.append(self.exec_tf)
        for symbol in self.symbols:
            for tf in timeframes:
                self.downloader.download_ohlcv(symbol, tf)
            self.downloader.download_ohlcv(symbol, self.exec_tf, kind="mark")
            self.downloader.download_funding(symbol)

        pad = effective_warmup(self.cfg) * timeframe_to_timedelta(self.exec_tf)
        start = pd.Timestamp.now("UTC") - pad * 1.2
        md = MarketData(symbols=list(self.symbols), split="paper")
        for symbol in self.symbols:
            for tf in timeframes:
                md.ohlcv[(symbol, tf)] = _prepare(self.store.read("ohlcv", symbol, tf, start=start))
            md.mark[symbol] = _prepare(self.store.read("mark", symbol, self.exec_tf, start=start))
            full = _prepare(self.store.read("funding_full", symbol, start=start))
            md.funding[symbol] = full if not full.empty else _prepare(self.store.read("funding", symbol, start=start))
            md.index[symbol] = _prepare(self.store.read("index", symbol, "1h", start=start))
            md.open_interest[symbol] = pd.DataFrame()
        self.funding = FundingModel(self.cfg, {s: md.funding.get(s) for s in self.symbols})
        self.sim.funding = self.funding
        return md

    # -------------------------------------------------------------- boucle
    def step(self, md: MarketData | None = None) -> dict[str, Any]:
        """Traite toutes les bougies closes non encore traitées."""
        md = md or self.refresh_data()
        strategy = RoutedMultiFamilyStrategy(self.cfg)
        strategy.prepare(md, self.cfg)

        last_done = to_utc(self.state.last_bar_ts) if self.state.last_bar_ts else None
        processed = 0
        equity = self.portfolio.equity({})

        frames = {s: md.ohlcv.get((s, self.exec_tf)) for s in self.symbols}
        frames = {s: f for s, f in frames.items() if f is not None and not f.empty}
        if not frames:
            return {"processed": 0, "equity": equity, "reason": "aucune donnée"}
        timeline = sorted(set().union(*[set(f.index) for f in frames.values()]))
        if last_done is not None:
            timeline = [ts for ts in timeline if ts > last_done]

        for ts in timeline:
            prices = {s: float(f.loc[ts, "close"]) for s, f in frames.items() if ts in f.index}
            opens = {s: float(f.loc[ts, "open"]) for s, f in frames.items() if ts in f.index}

            # 1. ordres en attente -> ouverture de la bougie
            for order in self._pending:
                self._execute(order, ts, frames, md, strategy)
            self._pending = []

            # 2. gestion des positions sur la bougie close
            for symbol in list(self.portfolio.positions.keys()):
                if symbol not in frames or ts not in frames[symbol].index:
                    continue
                bar = frames[symbol].loc[ts]
                mark_df = md.mark.get(symbol)
                mark_bar = mark_df.loc[ts] if mark_df is not None and ts in mark_df.index else None
                pos = self.portfolio.positions[symbol]
                event = self.sim.resolve_exit(pos, bar, mark_bar, ts)
                if event is not None:
                    self._close(symbol, event.price, ts, event.kind, bar, prices)
                    continue
                held = (ts - to_utc(pos.opened_at)).total_seconds() / 86400
                if held >= float(self.cfg.get_path("risk.max_holding_days")):
                    self._close(symbol, float(bar["close"]), ts, "timeout", bar, prices)

            # 3. funding
            for stamp in self.funding.settlements_between(ts, ts + pd.Timedelta(milliseconds=self.exec_ms)):
                for symbol, pos in list(self.portfolio.positions.items()):
                    price = prices.get(symbol, pos.entry_price)
                    self.portfolio.apply_funding(
                        symbol, self.funding.payment(symbol, stamp, pos.side, pos.notional(price))
                    )

            # 4. risque
            equity = self.portfolio.equity(prices)
            actions = self.risk.on_tick(ts, equity, self.portfolio.positions.values(),
                                        open_risk=self.portfolio.open_risk(equity))
            if actions:
                for symbol in list(self.portfolio.positions.keys()):
                    if symbol in frames and ts in frames[symbol].index:
                        self._close(symbol, prices[symbol], ts, "risk_halt", frames[symbol].loc[ts], prices)
                self._pending = []
                equity = self.portfolio.equity(prices)

            # 5. décision -> ordre pour la bougie suivante
            self._decide(ts, strategy, prices, equity)
            processed += 1
            self.state.bars_processed += 1

        if timeline:
            self._persist(equity, timeline[-1])
        return {
            "processed": processed,
            "equity": equity,
            "positions": len(self.portfolio.positions),
            "trades": len(self.portfolio.trades),
            "halted": self.risk.is_halted()[0],
        }

    # ---------------------------------------------------------------- ordres
    def _decide(self, ts, strategy, prices, equity) -> None:
        for symbol in self.symbols:
            dec = strategy.decisions(symbol)
            if dec is None or ts not in dec.index:
                continue
            row = dec.loc[ts]
            signal = float(row["signal"])
            pos = self.portfolio.positions.get(symbol)
            if pos is not None:
                if signal == 0 or (pos.side == "long" and signal < 0) or (pos.side == "short" and signal > 0):
                    self._pending.append(
                        Order(ts=ts, symbol=symbol, side="sell" if pos.side == "long" else "buy",
                              quantity=pos.quantity, intent="close")
                    )
                continue
            if signal == 0 or symbol not in prices:
                continue
            stop = float(row["stop_price"])
            if not np.isfinite(stop) or stop <= 0:
                continue
            side = "long" if signal > 0 else "short"
            decision = self.risk.validate_order(
                ts, symbol, side, prices[symbol], stop, equity,
                open_positions=self.portfolio.positions.values(),
                open_risk_pct=self.portfolio.open_risk(equity),
            )
            if not decision.approved:
                log.info("[paper] ordre refusé %s : %s", symbol, decision.reason)
                continue
            tp = float(row["take_profit"]) if np.isfinite(row["take_profit"]) else None
            self._pending.append(
                Order(ts=ts, symbol=symbol, side="buy" if side == "long" else "sell",
                      quantity=decision.sizing.quantity,
                      intent="open_long" if side == "long" else "open_short",
                      stop_loss=stop, take_profit=tp,
                      meta={"atr_pct": float(row["atr_pct"]), "regime": str(row["regime"]),
                            "families": str(row["families"])})
            )

    def _execute(self, order: Order, ts, frames, md, strategy) -> None:
        if order.symbol not in frames or ts not in frames[order.symbol].index:
            return
        bar = frames[order.symbol].loc[ts]
        prices = {s: float(f.loc[ts, "close"]) for s, f in frames.items() if ts in f.index}
        if order.intent == "close":
            if order.symbol in self.portfolio.positions:
                self._close(order.symbol, float(bar["open"]), ts, "signal", bar, prices)
            return
        side = "long" if order.intent == "open_long" else "short"
        equity = self.portfolio.equity(prices)
        decision = self.risk.validate_order(
            ts, order.symbol, side, float(bar["open"]), order.stop_loss, equity,
            open_positions=self.portfolio.positions.values(),
            open_risk_pct=self.portfolio.open_risk(equity),
        )
        if not decision.approved:
            log.info("[paper] ordre annulé à l'exécution %s : %s", order.symbol, decision.reason)
            return
        sizing = decision.sizing
        fill = self.sim.execute(
            Order(ts=ts, symbol=order.symbol, side=order.side, quantity=sizing.quantity,
                  intent=order.intent, stop_loss=order.stop_loss, take_profit=order.take_profit),
            bar, atr_pct=order.meta.get("atr_pct", 0.0), reference="open",
        )
        if fill is None:
            return
        liq = self.risk.liquidation_price(side, fill.price, sizing.quantity, sizing.margin)
        pos = Position(
            symbol=order.symbol, side=side, quantity=sizing.quantity, entry_price=fill.price,
            margin=sizing.margin, leverage=sizing.leverage, stop_loss=float(order.stop_loss),
            take_profit=float(order.take_profit) if order.take_profit else None,
            liquidation_price=liq, opened_at=ts, risk_amount=sizing.risk_amount,
            risk_pct=sizing.risk_pct, regime=str(order.meta.get("regime", "")),
            families=str(order.meta.get("families", "")),
        )
        self.portfolio.open_position(pos, fill.fee, fill.slippage_cost)
        log.info("[paper] %s %s %.6f @ %.2f (stop %.2f, liq %.2f)",
                 side, order.symbol, sizing.quantity, fill.price, order.stop_loss, liq)

    def _close(self, symbol, price, ts, reason, bar, prices) -> None:
        pos = self.portfolio.positions.get(symbol)
        if pos is None:
            return
        side = "sell" if pos.side == "long" else "buy"
        fill = self.sim.execute(
            Order(ts=ts, symbol=symbol, side=side, quantity=pos.quantity, intent="close"),
            bar, reference="close", price_override=float(price),
        )
        exit_price = float(price) if reason == "liquidation" else (fill.price if fill else float(price))
        fee = fill.fee if fill else abs(pos.quantity) * float(price) * self.costs.taker
        slip = fill.slippage_cost if fill else 0.0
        trade = self.portfolio.close_position(
            symbol, exit_price, ts, fee, slip, reason, "live",
            lose_full_margin=reason == "liquidation", prices=prices,
        )
        log.info("[paper] sortie %s %s @ %.2f — PnL net %.2f (%.2f R)",
                 symbol, reason, exit_price, trade.net_pnl, trade.r_multiple)

    # ------------------------------------------------------------------ run
    def run(self, max_iterations: int | None = None, poll_seconds: int | None = None) -> None:
        poll = int(poll_seconds or self.cfg.get_path("paper.poll_seconds"))
        iteration = 0
        while max_iterations is None or iteration < max_iterations:
            try:
                status = self.step()
                log.info("[paper] %s", status)
            except KeyboardInterrupt:
                log.info("[paper] arrêt demandé")
                break
            except Exception as exc:  # noqa: BLE001
                log.exception("[paper] erreur de boucle : %s", exc)
            iteration += 1
            if max_iterations is None or iteration < max_iterations:
                time.sleep(poll)


# ---------------------------------------------------------------------------
def compare_live_vs_backtest(
    live_trades: pd.DataFrame,
    live_equity: pd.Series,
    backtest_metrics: dict[str, Any],
    days_per_year: int = 365,
) -> pd.DataFrame:
    """Comparaison des métriques live et backtest (§10, phase 7).

    Les écarts attendus sont surtout dans le slippage réalisé et le taux de
    remplissage : c'est précisément ce que 60 jours de paper trading servent à
    mesurer avant d'engager du capital.
    """
    from ..reports.metrics import compute_metrics

    live = compute_metrics(live_equity, live_trades, days_per_year=days_per_year, name="paper")
    keys = [
        "cagr", "sharpe", "sortino", "max_drawdown", "win_rate", "profit_factor",
        "expectancy_r", "avg_holding_hours", "trades", "liquidations",
        "costs_over_gross_pnl", "monthly_median",
    ]
    rows = []
    for key in keys:
        b = backtest_metrics.get(key)
        l = live.metrics.get(key)
        delta = (l - b) if isinstance(b, (int, float)) and isinstance(l, (int, float)) \
            and np.isfinite(b) and np.isfinite(l) else float("nan")
        rows.append({"métrique": key, "backtest": b, "paper": l, "écart": delta})
    return pd.DataFrame(rows)
