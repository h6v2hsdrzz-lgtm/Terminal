"""Boucle de backtest event-driven.

Séquence stricte à l'intérieur d'une barre ``t`` (timeframe d'exécution) :

1. exécution des ordres en attente à l'**ouverture** de ``t`` (décidés à la
   clôture de ``t-1``) ;
2. gestion intrabar des positions : liquidation (mark price) > stop > take
   profit > durée maximale de détention ;
3. règlements de funding tombant dans ``]t_open, t_close]`` ;
4. valorisation à la clôture, tick du moteur de risque (invariants + coupe-
   circuits), mise à plat forcée le cas échéant ;
5. décision de la stratégie sur la clôture de ``t`` -> ordres en attente pour
   l'ouverture de ``t+1``.

Aucune étape ne consulte une information postérieure à l'instant simulé.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..config import Config
from ..data.loader import MarketData
from ..execution.costs import CostModel, FundingModel
from ..features.pipeline import effective_warmup
from ..execution.simulator import ExecutionSimulator, Order
from ..risk.engine import RiskEngine
from ..utils import get_logger, timeframe_to_ms, to_utc
from .portfolio import Portfolio, Position

log = get_logger("backtest.engine")


@dataclass
class BacktestResult:
    equity: pd.DataFrame
    trades: pd.DataFrame
    risk_events: pd.DataFrame
    rejections: pd.DataFrame
    stats: dict[str, Any] = field(default_factory=dict)
    config_snapshot: dict[str, Any] = field(default_factory=dict)
    strategy_name: str = ""
    split: str = ""

    @property
    def final_equity(self) -> float:
        return float(self.equity["equity"].iloc[-1]) if len(self.equity) else float("nan")


class BacktestEngine:
    def __init__(
        self,
        cfg: Config,
        market_data: MarketData,
        strategy,
        cost_stress: float = 1.0,
        seed: int | None = None,
        initial_equity: float | None = None,
    ):
        self.cfg = cfg
        self.md = market_data
        self.strategy = strategy
        self.exec_tf = str(cfg.get_path("data.execution_timeframe"))
        self.exec_tf_ms = timeframe_to_ms(self.exec_tf)
        self.rng = np.random.default_rng(seed if seed is not None else int(cfg.get_path("backtest.seed")))
        self.risk = RiskEngine(cfg, initial_equity=initial_equity)
        self.portfolio = Portfolio(self.risk.initial_equity)
        self.costs = CostModel(cfg, stress_multiplier=cost_stress)
        self.funding = FundingModel(
            cfg,
            funding={s: market_data.funding.get(s) for s in market_data.symbols},
            stress_multiplier=cost_stress,
        )
        intrabar_tf = str(cfg.get_path("data.intrabar_timeframe"))
        intrabar = {
            s: market_data.ohlcv[(s, intrabar_tf)]
            for s in market_data.symbols
            if (s, intrabar_tf) in market_data.ohlcv and not market_data.ohlcv[(s, intrabar_tf)].empty
        }
        self.sim = ExecutionSimulator(
            cfg, cost_model=self.costs, funding_model=self.funding, rng=self.rng, intrabar=intrabar
        )
        self.lose_full_margin = bool(cfg.get_path("execution.liquidation.lose_full_margin", True))
        self.max_holding_days = float(cfg.get_path("risk.max_holding_days"))
        self.rejections: list[dict[str, Any]] = []
        self._pending: list[Order] = []

    # ------------------------------------------------------------------ setup
    def _build_arrays(self, symbols: list[str]):
        frames = {s: self.md.get(s, self.exec_tf) for s in symbols}
        frames = {s: df for s, df in frames.items() if df is not None and not df.empty}
        if not frames:
            raise ValueError(f"aucune donnée {self.exec_tf} disponible")
        timeline = sorted(set().union(*[set(df.index) for df in frames.values()]))
        timeline = pd.DatetimeIndex(timeline)

        arrays: dict[str, dict[str, np.ndarray]] = {}
        for s, df in frames.items():
            pos = df.index.get_indexer(timeline)
            a = {
                "pos": pos,
                "open": df["open"].to_numpy(float),
                "high": df["high"].to_numpy(float),
                "low": df["low"].to_numpy(float),
                "close": df["close"].to_numpy(float),
                "volume": df["volume"].to_numpy(float),
            }
            mark = self.md.mark.get(s)
            if mark is not None and not mark.empty:
                mpos = mark.index.get_indexer(timeline)
                a["mark_pos"] = mpos
                a["mark_high"] = mark["high"].to_numpy(float)
                a["mark_low"] = mark["low"].to_numpy(float)
            arrays[s] = a
        return timeline, frames, arrays

    def _decision_arrays(self, symbols: list[str], timeline: pd.DatetimeIndex):
        """Aligne les décisions de la stratégie sur la timeline d'exécution."""
        out: dict[str, dict[str, np.ndarray]] = {}
        for s in symbols:
            dec = self.strategy.decisions(s)
            if dec is None or dec.empty:
                continue
            dec = dec.reindex(timeline)
            block = {
                "signal": dec.get("signal", pd.Series(0.0, index=timeline)).fillna(0.0).to_numpy(float),
                "stop_price": dec.get("stop_price", pd.Series(np.nan, index=timeline)).to_numpy(float),
                "take_profit": dec.get("take_profit", pd.Series(np.nan, index=timeline)).to_numpy(float),
                "atr_pct": dec.get("atr_pct", pd.Series(0.0, index=timeline)).fillna(0.0).to_numpy(float),
            }
            block["regime"] = dec.get("regime", pd.Series("", index=timeline)).fillna("").to_numpy(object)
            block["families"] = dec.get("families", pd.Series("", index=timeline)).fillna("").to_numpy(object)
            out[s] = block
        return out

    # ------------------------------------------------------------------- run
    def run(self) -> BacktestResult:
        symbols = [s for s in self.md.symbols]
        self.strategy.prepare(self.md, self.cfg)
        timeline, frames, arrays = self._build_arrays(symbols)
        decisions = self._decision_arrays(symbols, timeline)
        symbols = [s for s in symbols if s in arrays]

        warmup = effective_warmup(self.cfg)
        self.risk.start(timeline[0], self.portfolio.initial_equity)
        equity_ts: list[pd.Timestamp] = []
        equity_val: list[float] = []
        halted_bars = 0
        exposure_bars = 0

        for i in range(len(timeline)):
            ts = timeline[i]
            bar_end = ts + pd.Timedelta(milliseconds=self.exec_tf_ms)

            prices_open: dict[str, float] = {}
            prices_close: dict[str, float] = {}
            for s in symbols:
                p = arrays[s]["pos"][i]
                if p >= 0:
                    prices_open[s] = arrays[s]["open"][p]
                    prices_close[s] = arrays[s]["close"][p]

            # ---------------- 1. ordres en attente -> ouverture de la barre ----
            if self._pending:
                pending, self._pending = self._pending, []
                for order in pending:
                    self._execute_pending(order, ts, i, arrays, frames)

            # ---------------- 2. gestion intrabar des positions ---------------
            for symbol in list(self.portfolio.positions.keys()):
                if symbol not in prices_close:
                    continue
                self._manage_position(symbol, ts, i, arrays, frames, prices_close)

            # ---------------- 3. funding ---------------------------------------
            self._settle_funding(ts, bar_end, prices_close)

            # ---------------- 4. valorisation + risque -------------------------
            for pos in self.portfolio.positions.values():
                pos.bars_held += 1
            equity = self.portfolio.equity(prices_close)
            actions = self.risk.on_tick(
                ts, equity, self.portfolio.positions.values(),
                open_risk=self.portfolio.open_risk(equity),
            )
            if actions:
                self._flatten_all(ts, i, arrays, frames, prices_close, reason="risk_halt")
                equity = self.portfolio.equity(prices_close)

            equity_ts.append(ts)
            equity_val.append(equity)
            if self.portfolio.positions:
                exposure_bars += 1
            halted, _ = self.risk.is_halted()
            if halted:
                halted_bars += 1

            # ---------------- 5. décision de la stratégie -----------------------
            if i >= warmup and not self.risk.killed:
                self._decide(ts, i, symbols, decisions, arrays, prices_close, equity)

        # clôture finale au dernier prix connu
        last_ts = timeline[-1]
        last_prices = {}
        for s in symbols:
            p = arrays[s]["pos"][-1]
            if p >= 0:
                last_prices[s] = arrays[s]["close"][p]
        if self.portfolio.positions:
            self._flatten_all(last_ts, len(timeline) - 1, arrays, frames, last_prices, reason="end_of_backtest")
            equity_val[-1] = self.portfolio.equity(last_prices)

        equity_df = pd.DataFrame({"equity": equity_val}, index=pd.DatetimeIndex(equity_ts, name="dt"))
        trades_df = self.portfolio.trades_frame()
        stats = {
            "bars": len(timeline),
            "exposure_bars": exposure_bars,
            "exposure_ratio": exposure_bars / max(len(timeline), 1),
            "halted_bars": halted_bars,
            "halted_ratio": halted_bars / max(len(timeline), 1),
            "liquidations": self.portfolio.liquidations,
            "total_fees": self.portfolio.total_fees,
            "total_funding": self.portfolio.total_funding,
            "total_slippage": self.portfolio.total_slippage,
            "rejections": len(self.rejections),
            **{f"exec_{k}": v for k, v in self.sim.stats.items()},
            **self.risk.summary(),
        }
        return BacktestResult(
            equity=equity_df,
            trades=trades_df,
            risk_events=self.risk.events_frame(),
            rejections=pd.DataFrame(self.rejections),
            stats=stats,
            config_snapshot={
                "risk_per_trade": self.risk.risk_per_trade,
                "leverage_max": self.risk.leverage_max,
                "cost_stress": self.costs.stress,
                "execution_timeframe": self.exec_tf,
            },
            strategy_name=getattr(self.strategy, "name", type(self.strategy).__name__),
            split=self.md.split,
        )

    # --------------------------------------------------------------- internes
    def _bar_series(self, symbol: str, i: int, arrays, frames) -> pd.Series | None:
        p = arrays[symbol]["pos"][i]
        if p < 0:
            return None
        a = arrays[symbol]
        return pd.Series(
            {
                "open": a["open"][p], "high": a["high"][p], "low": a["low"][p],
                "close": a["close"][p], "volume": a["volume"][p],
            }
        )

    def _mark_bar(self, symbol: str, i: int, arrays) -> pd.Series | None:
        a = arrays[symbol]
        if "mark_pos" not in a:
            return None
        p = a["mark_pos"][i]
        if p < 0:
            return None
        return pd.Series({"high": a["mark_high"][p], "low": a["mark_low"][p]})

    def _execute_pending(self, order: Order, ts, i, arrays, frames) -> None:
        bar = self._bar_series(order.symbol, i, arrays, frames)
        if bar is None:
            self._reject(ts, order.symbol, "no_bar", "barre absente à l'exécution")
            return
        order.ts = ts

        if order.intent == "close":
            if order.symbol not in self.portfolio.positions:
                return
            self._close(order.symbol, float(bar["open"]), ts, "signal", "", bar, i, arrays)
            return

        # ré-validation au moment du fill : la halte a pu s'activer entre-temps
        side = "long" if order.intent == "open_long" else "short"
        equity = self.portfolio.equity({order.symbol: float(bar["open"])})
        decision = self.risk.validate_order(
            ts, order.symbol, side, float(bar["open"]), order.stop_loss, equity,
            open_positions=self.portfolio.positions.values(),
            open_risk_pct=self.portfolio.open_risk(equity),
        )
        if not decision.approved:
            self._reject(ts, order.symbol, decision.code, decision.reason)
            return

        sizing = decision.sizing
        fill = self.sim.execute(
            Order(ts=ts, symbol=order.symbol, side=order.side, quantity=sizing.quantity,
                  intent=order.intent, stop_loss=order.stop_loss, take_profit=order.take_profit),
            bar, atr_pct=order.meta.get("atr_pct", 0.0), reference="open",
        )
        if fill is None:
            self._reject(ts, order.symbol, "exchange_reject", "ordre rejeté par l'exchange")
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

    def _manage_position(self, symbol, ts, i, arrays, frames, prices_close) -> None:
        pos = self.portfolio.positions.get(symbol)
        if pos is None:
            return
        bar = self._bar_series(symbol, i, arrays, frames)
        if bar is None:
            return
        mark_bar = self._mark_bar(symbol, i, arrays)
        event = self.sim.resolve_exit(pos, bar, mark_bar, ts)
        if event is not None:
            self._close(symbol, event.price, event.ts, event.kind, event.resolved_with, bar, i, arrays)
            return
        # durée maximale de détention
        if self.max_holding_days > 0:
            held_days = (to_utc(ts) - to_utc(pos.opened_at)).total_seconds() / 86400.0
            if held_days >= self.max_holding_days:
                self._close(symbol, float(bar["close"]), ts, "timeout", "", bar, i, arrays)

    def _close(self, symbol, price, ts, reason, resolved_with, bar, i, arrays) -> None:
        pos = self.portfolio.positions.get(symbol)
        if pos is None:
            return
        side = "sell" if pos.side == "long" else "buy"
        fill = self.sim.execute(
            Order(ts=ts, symbol=symbol, side=side, quantity=pos.quantity, intent="close"),
            bar, reference="close", price_override=float(price),
        )
        if fill is None:
            # un rejet ne dispense pas de sortir : on force au prix de référence
            exit_price, fee, slip = float(price), abs(pos.quantity) * float(price) * self.costs.taker, 0.0
        else:
            exit_price, fee, slip = fill.price, fill.fee, fill.slippage_cost
        if reason == "liquidation":
            exit_price = float(price)  # la liquidation s'exécute au prix de liquidation
        prices = {s: arrays[s]["close"][arrays[s]["pos"][i]] for s in arrays if arrays[s]["pos"][i] >= 0}
        self.portfolio.close_position(
            symbol, exit_price, ts, fee, slip, reason, resolved_with,
            lose_full_margin=self.lose_full_margin and reason == "liquidation",
            prices=prices,
        )

    def _flatten_all(self, ts, i, arrays, frames, prices_close, reason: str) -> None:
        for symbol in list(self.portfolio.positions.keys()):
            bar = self._bar_series(symbol, i, arrays, frames)
            if bar is None:
                continue
            self._close(symbol, float(bar["close"]), ts, reason, "", bar, i, arrays)
        self._pending = []

    def _settle_funding(self, bar_start, bar_end, prices_close) -> None:
        if not self.portfolio.positions or not self.funding.enabled:
            return
        stamps = self.funding.settlements_between(bar_start, bar_end)
        if len(stamps) == 0:
            return
        for symbol, pos in list(self.portfolio.positions.items()):
            price = prices_close.get(symbol, pos.entry_price)
            notional = pos.notional(price)
            for stamp in stamps:
                amount = self.funding.payment(symbol, stamp, pos.side, notional)
                self.portfolio.apply_funding(symbol, amount)

    def _decide(self, ts, i, symbols, decisions, arrays, prices_close, equity) -> None:
        for symbol in symbols:
            block = decisions.get(symbol)
            if block is None:
                continue
            signal = block["signal"][i]
            if not np.isfinite(signal):
                continue
            pos = self.portfolio.positions.get(symbol)
            price = prices_close.get(symbol)
            if price is None:
                continue

            # sortie sur signal (inversion ou retour à plat)
            if pos is not None:
                wants_flat = signal == 0
                wants_flip = (pos.side == "long" and signal < 0) or (pos.side == "short" and signal > 0)
                if wants_flat or wants_flip:
                    self._pending.append(
                        Order(ts=ts, symbol=symbol, side="sell" if pos.side == "long" else "buy",
                              quantity=pos.quantity, intent="close")
                    )
                continue

            if signal == 0:
                continue
            stop = block["stop_price"][i]
            if not np.isfinite(stop) or stop <= 0:
                self._reject(ts, symbol, "no_stop", "aucun stop fourni par la stratégie")
                continue
            side = "long" if signal > 0 else "short"
            decision = self.risk.validate_order(
                ts, symbol, side, float(price), float(stop), equity,
                open_positions=self.portfolio.positions.values(),
                open_risk_pct=self.portfolio.open_risk(equity),
            )
            if not decision.approved:
                self._reject(ts, symbol, decision.code, decision.reason)
                continue
            tp = block["take_profit"][i]
            self._pending.append(
                Order(
                    ts=ts, symbol=symbol, side="buy" if side == "long" else "sell",
                    quantity=decision.sizing.quantity,
                    intent="open_long" if side == "long" else "open_short",
                    stop_loss=float(stop),
                    take_profit=float(tp) if np.isfinite(tp) and tp > 0 else None,
                    meta={
                        "atr_pct": float(block["atr_pct"][i]),
                        "regime": block["regime"][i],
                        "families": block["families"][i],
                    },
                )
            )

    def _reject(self, ts, symbol, code, reason) -> None:
        self.rejections.append({"ts": ts, "symbol": symbol, "code": code, "reason": reason})
