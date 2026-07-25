"""Boucle de backtest event-driven (§10).

Sequence exacte a l'interieur de la barre i, dans cet ordre :

  1. execution des ordres emis a la cloture de la barre i-1 (maker d'abord,
     bascule taker apres timeout) ;
  2. resolution intrabar : stops et liquidations, sur le chemin 1 minute des
     que la barre horaire rend l'evenement possible ;
  3. reglement du funding si l'heure est 00 / 08 / 16 UTC ;
  4. valorisation au mark price, mise a jour du moteur de risque, mises a plat
     eventuelles ;
  5. lecture des poids cibles a la cloture de la barre i et emission des ordres
     pour la barre i+1.

Le signal de la barre i n'est donc jamais executable dans la barre i. Le
decalage est structurel, pas un parametre.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..data.panel import Panel
from ..execution.costs import CostModel, CostParams
from ..execution.simulator import Fill, FillSimulator, MakerParams
from ..features.core import atr as atr_fn
from ..risk.engine import KillSwitchTriggered, RiskEngine, RiskLimits

log = logging.getLogger("okx_algo.engine")

FUNDING_HOURS = (0, 8, 16)


@dataclass
class Position:
    symbol: str
    qty: float                 # contrats, signe
    entry_price: float
    entry_idx: int
    entry_ts: pd.Timestamp
    stop_price: float
    is_cascade: bool
    exit_by_idx: int
    entry_direction: int = 0
    funding_paid: float = 0.0
    fees_paid: float = 0.0
    realized: float = 0.0
    peak_qty: float = 0.0
    initial_risk: float = 0.0  # perte au stop a l'ouverture, en USDT (unite R)


@dataclass
class WorkingOrder:
    symbol: str
    side: int                  # +1 achat, -1 vente
    qty: float                 # contrats, valeur absolue
    limit: float
    placed_idx: int
    is_cascade: bool
    stop_price: float
    exit_by_idx: int
    reducing: bool


@dataclass
class Trade:
    symbol: str
    direction: int
    entry_ts: pd.Timestamp
    exit_ts: pd.Timestamp
    entry_price: float
    exit_price: float
    qty: float
    gross_pnl: float
    fees: float
    funding: float
    net_pnl: float
    r_multiple: float
    exit_reason: str
    bars_held: int
    is_cascade: bool


@dataclass
class BacktestResult:
    equity: pd.Series
    returns: pd.Series
    trades: pd.DataFrame
    positions_log: pd.DataFrame
    stats: dict
    risk_events: pd.DataFrame
    attribution: pd.DataFrame


@dataclass
class Targets:
    """Sortie du portefeuille consommee par le moteur."""
    weights: np.ndarray        # (n, k) fraction d'equity, signee
    stops: np.ndarray          # (n, k) prix
    exit_by: np.ndarray        # (n, k) index de barre, -1 si aucun
    cascade: np.ndarray        # (n, k) bool
    attribution: dict = field(default_factory=dict)   # nom de brique -> (n, k)


class BacktestEngine:
    def __init__(self, cfg, panel: Panel, *, leverage: float = 1.0,
                 cost_stress: float = 1.0, seed: int | None = None,
                 strict_risk: bool = True, initial_equity: float | None = None,
                 funding_enabled: bool = True):
        self.cfg = cfg
        self.panel = panel
        self.symbols = panel.symbols
        self.leverage = leverage
        self.funding_enabled = funding_enabled
        self.initial_equity = (initial_equity if initial_equity is not None
                               else cfg.get("backtest.initial_equity", 100_000.0))
        self.rng = np.random.default_rng(seed if seed is not None else cfg.get("project.seed"))
        self.costs = CostModel(CostParams.from_config(cfg, stress=cost_stress))
        self.maker_params = MakerParams.from_config(cfg)
        self.fills = FillSimulator(self.costs, self.maker_params, self.rng)
        self.risk = RiskEngine(RiskLimits.from_config(cfg), strict=strict_risk)
        self.min_order_fraction = cfg.get("backtest.min_order_fraction", 0.002)
        # Le stop par defaut est DERIVE de l'horizon annonce du mandat (1 a 5
        # jours, mediane 3), pas choisi sur les resultats : l'excursion typique
        # d'une position tenue h jours vaut ~ATR(24h) * sqrt(h), et le stop est
        # place a k ecarts-types de cette excursion. Un stop plus serre serait
        # un signal deguise, pas un filet de securite, et tuerait une strategie
        # de momentum par accumulation de sorties premature es.
        self.default_stop_atr = (cfg.get("risk.default_stop_sigma_multiple")
                                 * np.sqrt(cfg.get("risk.default_stop_horizon_days")))
        self.mmr = cfg.get("margin.maintenance_margin_rate")
        self.liq_penalty = cfg.get("margin.taker_liquidation_penalty")
        self.ct_val = {s: cfg.get(f"margin.contract_values.{s}", 1.0) for s in self.symbols}
        self.tick = {s: 0.1 for s in self.symbols}
        # Un stop declare que la these de la position est invalidee. Rentrer a
        # nouveau 15 minutes plus tard sur un signal inchange n'est pas de la
        # gestion du risque, c'est du churn : c'est le mecanisme qui detruisait
        # le plus de PnL a la mesure. Apres un stop, le sens concerne est bloque
        # jusqu'a ce que le signal se re-arme (changement de signe ou retour a
        # zero), avec une duree maximale de blocage.
        self.stop_rearm_max_hours = cfg.get("risk.stop_rearm_max_hours", 24)
        self.funding_guard = cfg.get("risk.funding_cost_guard")
        self.funding_guard_red = cfg.get("risk.funding_guard_reduction")
        self._prepare_arrays()

    # ------------------------------------------------------------------
    def _prepare_arrays(self) -> None:
        p = self.panel
        n, k = p.n, len(self.symbols)
        self.close = np.column_stack([p.data[s].close for s in self.symbols])
        self.open = np.column_stack([p.data[s].open for s in self.symbols])
        self.high = np.column_stack([p.data[s].high for s in self.symbols])
        self.low = np.column_stack([p.data[s].low for s in self.symbols])
        self.mark = np.column_stack([p.data[s].mark_close for s in self.symbols])
        self.mark_hi = np.column_stack([p.data[s].mark_high for s in self.symbols])
        self.mark_lo = np.column_stack([p.data[s].mark_low for s in self.symbols])
        self.fund = np.column_stack([p.data[s].funding for s in self.symbols])
        self.vq = np.column_stack([p.data[s].volume_quote for s in self.symbols])
        self.valid = np.column_stack([p.data[s].valid for s in self.symbols])

        # tout ce qui suit est exprime en heures puis converti en barres :
        # le moteur doit se comporter identiquement en 15m et en 1H.
        step_minutes = {"1m": 1, "15m": 15, "1H": 60, "4H": 240, "1D": 1440}[p.timeframe]
        self.bars_per_hour = 60.0 / step_minutes
        atr_bars = max(2, int(round(24 * self.bars_per_hour)))
        med_bars = max(10, int(round(90 * 24 * self.bars_per_hour)))
        min_bars = max(5, int(round(5 * 24 * self.bars_per_hour)))

        self.atr = np.full((n, k), np.nan)
        for j, s in enumerate(self.symbols):
            d = p.data[s]
            self.atr[:, j] = atr_fn(d.high, d.low, d.close, atr_bars)
        with np.errstate(invalid="ignore", divide="ignore"):
            self.atr_frac = self.atr / self.close
        med = (pd.DataFrame(self.atr_frac).rolling(med_bars, min_periods=min_bars)
               .median().to_numpy())
        with np.errstate(invalid="ignore", divide="ignore"):
            self.vol_ratio = np.where(med > 0, self.atr_frac / med, 1.0)
        self.vol_ratio = np.nan_to_num(self.vol_ratio, nan=1.0, posinf=3.0)
        # le funding se regle a l'heure pile : sur une grille 15m, une seule
        # barre sur quatre porte le reglement.
        self.is_funding_bar = (np.isin(p.index.hour.to_numpy(), FUNDING_HOURS)
                               & (p.index.minute.to_numpy() == 0))

    # ------------------------------------------------------------------
    def run(self, targets: Targets, i0: int = 0, i1: int | None = None,
            label: str = "run") -> BacktestResult:
        p = self.panel
        i1 = p.n if i1 is None else i1
        cash = self.initial_equity
        positions: dict[str, Position] = {}
        blocked: dict[str, tuple[int, int]] = {}   # symbole -> (sens bloque, jusqu'a)
        working: list[WorkingOrder] = []
        trades: list[Trade] = []
        equity_curve = np.full(i1 - i0, np.nan)
        gross_curve = np.full(i1 - i0, np.nan)
        n_liquidations = 0
        netting_log: list[dict] = []
        attribution_pnl = {name: 0.0 for name in targets.attribution}
        gross_pnl_total = 0.0
        fees_total = 0.0
        funding_total = 0.0

        self.risk.start(cash, p.index[i0])
        prev_equity_for_attr = cash

        for step, i in enumerate(range(i0, i1)):
            ts = p.index[i]

            # -- 1. execution des ordres emis a la barre precedente ------
            cash, fees_paid, working = self._execute_working(working, positions, i,
                                                             cash, trades)
            fees_total += fees_paid

            # -- 2. stops et liquidations, resolution intrabar ------------
            cash, closed, fees_paid = self._resolve_exits(positions, i, cash, trades,
                                                          blocked)
            fees_total += fees_paid
            cash, liq, fees_paid = self._check_liquidation(positions, i, cash, trades)
            fees_total += fees_paid
            n_liquidations += liq

            # -- 3. funding ---------------------------------------------
            if self.is_funding_bar[i]:
                paid = self._settle_funding(positions, i)
                cash -= paid
                funding_total += paid
                self._apply_funding_guard(positions, i, working)

            # -- 4. valorisation et moteur de risque ---------------------
            equity = cash + self._unrealized(positions, i)
            gross = self._gross_notional(positions, i)
            equity_curve[step] = equity
            gross_curve[step] = gross / equity if equity > 0 else np.nan

            if equity <= 0:
                log.warning("%s: equity nulle a %s, arret", label, ts)
                equity_curve[step:] = 0.0
                break

            action = self.risk.update(ts, equity)
            if action is not None:
                cash, fees_paid = self._flatten_all(positions, i, cash, trades,
                                                    reason=action)
                fees_total += fees_paid
                working.clear()
                equity = cash
                equity_curve[step] = equity
                if action == "kill":
                    log.warning("%s: kill switch a %s", label, ts)
                    equity_curve[step:] = equity
                    break

            self.risk.assert_invariants(
                ts=ts, equity=equity, gross_notional=self._gross_notional(positions, i),
                n_positions=len(positions),
                n_cascade=sum(1 for q in positions.values() if q.is_cascade),
                positions_without_stop=sum(1 for q in positions.values()
                                           if not np.isfinite(q.stop_price)),
            )

            # -- 5. emission des ordres pour la barre i+1 -----------------
            if i + 1 < i1 and not self.risk.is_halted(ts):
                fresh = self._emit_orders(targets, positions, i, equity, netting_log,
                                          blocked, working)
                if fresh:
                    # un nouvel ordre sur un symbole annule et remplace l'ancien
                    replaced = {o.symbol for o in fresh}
                    working = [o for o in working if o.symbol not in replaced] + fresh
            else:
                working = []

            prev_equity_for_attr = equity

        # ------------------------------------------------------------------
        idx = p.index[i0:i1]
        eq = pd.Series(equity_curve, index=idx, name="equity").ffill()
        rets = eq.pct_change().fillna(0.0)
        trades_df = pd.DataFrame([t.__dict__ for t in trades])
        stats = {
            "n_liquidations": n_liquidations,
            "maker_fill_rate": self.fills.maker_fill_rate,
            "maker_attempts": self.fills.n_maker_attempts,
            "fees_total": fees_total,
            "funding_total": funding_total,
            "final_equity": float(eq.iloc[-1]) if len(eq) else self.initial_equity,
            "initial_equity": self.initial_equity,
            "leverage_applied": self.leverage,
            "mean_gross_leverage": float(np.nanmean(gross_curve)),
            "max_gross_leverage": float(np.nanmax(gross_curve)) if np.isfinite(gross_curve).any() else 0.0,
            "n_netting_events": len(netting_log),
            "killed": self.risk.state.killed,
        }
        return BacktestResult(
            equity=eq,
            returns=rets,
            trades=trades_df,
            positions_log=pd.DataFrame(netting_log),
            stats=stats,
            risk_events=pd.DataFrame(self.risk.state.events),
            attribution=pd.DataFrame(),
        )

    # ==================================================================
    # Execution
    # ==================================================================
    def _execute_working(self, working: list[WorkingOrder],
                         positions: dict[str, Position], i: int, cash: float,
                         trades: list[Trade]) -> tuple[float, float, list[WorkingOrder]]:
        """Retourne (cash, frais, ordres encore en carnet).

        Un ordre limite non rempli N'EST PAS abandonne : il reste en carnet
        jusqu'a `timeout_bars`, puis bascule en taker. C'est tout l'interet du
        maker-first — et l'oublier revenait a ne jamais executer un seul ordre.
        """
        fees = 0.0
        remaining: list[WorkingOrder] = []
        for order in working:
            j = self.symbols.index(order.symbol)
            if not self.valid[i, j]:
                remaining.append(order)
                continue
            ref = self._entry_reference(i, j)
            if not np.isfinite(ref) or ref <= 0:
                remaining.append(order)
                continue
            bar_range = self.high[i, j] - self.low[i, j]
            fill: Fill | None = None
            passive = self.maker_params.enabled and not order.reducing

            if passive and self.fills.try_maker(order.side, order.limit, self.low[i, j],
                                                self.high[i, j], bar_range):
                fill = self.fills.execute_maker(order.side * order.qty, order.limit,
                                                self.ct_val[order.symbol])
            if fill is None:
                age = i - order.placed_idx
                timed_out = age >= self.maker_params.timeout_bars
                if order.reducing or not passive or timed_out:
                    fill = self.fills.execute_taker(
                        order.side, order.side * order.qty, ref, self.ct_val[order.symbol],
                        self.atr_frac[i, j] if np.isfinite(self.atr_frac[i, j]) else 0.0,
                        max(self.vq[i, j], 1.0), self.vol_ratio[i, j])
                else:
                    remaining.append(order)
                    continue
            cash, fee = self._apply_fill(positions, order, fill, i, cash, trades)
            fees += fee
        return cash, fees, remaining

    def _entry_reference(self, i: int, j: int) -> float:
        """Prix de reference a l'entree de la barre, latence 200-500 ms incluse.

        Avec le 1 minute disponible, on prend la cloture de la premiere minute :
        c'est le prix realiste apres latence, pas l'ouverture theorique.
        """
        d = self.panel.data[self.symbols[j]]
        if len(d.m1_slice) > i:
            a, b = d.m1_slice[i]
            if b > a and len(d.m1_close) > a:
                return float(d.m1_close[a])
        return float(self.open[i, j])

    def _apply_fill(self, positions: dict[str, Position], order: WorkingOrder,
                    fill: Fill, i: int, cash: float,
                    trades: list[Trade]) -> tuple[float, float]:
        sym = order.symbol
        ct = self.ct_val[sym]
        cash -= fill.fee
        pos = positions.get(sym)
        qty_delta = fill.qty

        if pos is None:
            if abs(qty_delta) < 1e-12:
                return cash, fill.fee
            positions[sym] = self._open(sym, qty_delta, fill, i, order, ct)
            return cash, fill.fee

        same_side = np.sign(qty_delta) == np.sign(pos.qty)
        if same_side:
            # renforcement : prix d'entree moyen pondere
            total = pos.qty + qty_delta
            pos.entry_price = (pos.entry_price * pos.qty + fill.price * qty_delta) / total
            pos.qty = total
            pos.peak_qty = max(pos.peak_qty, abs(total))
            pos.fees_paid += fill.fee
            if np.isfinite(order.stop_price):
                pos.stop_price = order.stop_price
        else:
            closing = min(abs(qty_delta), abs(pos.qty)) * np.sign(qty_delta)
            realized = -closing * ct * (fill.price - pos.entry_price)
            cash += realized
            pos.realized += realized
            pos.qty += closing
            pos.fees_paid += fill.fee
            residual = qty_delta - closing
            if abs(pos.qty) < 1e-9:
                pos.qty = 0.0

            if abs(pos.qty) < 1e-12:
                # Sortie pilotee par le signal. Elle DOIT etre journalisee comme
                # un trade : sans cela le journal ne contiendrait que les sorties
                # sur stop et toutes les statistiques de trade seraient biaisees.
                self._record(trades, pos, i, fill.price, "signal")
                positions.pop(sym, None)
                if abs(residual) > 1e-12:
                    positions[sym] = self._open(sym, residual, fill, i, order, ct,
                                                force_direction=True)
                return cash, fill.fee

        if order.exit_by_idx >= 0:
            pos.exit_by_idx = order.exit_by_idx
        pos.is_cascade = pos.is_cascade or order.is_cascade
        return cash, fill.fee

    def _open(self, sym: str, qty: float, fill: Fill, i: int, order: WorkingOrder,
              ct: float, force_direction: bool = False) -> Position:
        j = self.symbols.index(sym)
        stop = order.stop_price
        if force_direction or not np.isfinite(stop) or \
                np.sign(stop - fill.price) == np.sign(qty):
            # stop du mauvais cote (retournement) ou absent : on le derive
            stop = self._default_stop(i, j, np.sign(qty), fill.price)
        return Position(
            symbol=sym, qty=qty, entry_price=fill.price, entry_idx=i,
            entry_ts=self.panel.index[i], stop_price=stop,
            is_cascade=order.is_cascade, exit_by_idx=order.exit_by_idx,
            entry_direction=int(np.sign(qty)), fees_paid=fill.fee, peak_qty=abs(qty),
            initial_risk=abs(qty) * ct * abs(fill.price - stop))

    def _record(self, trades: list[Trade], pos: Position, i: int, exit_price: float,
                reason: str, extra_fee: float = 0.0) -> None:
        total_fees = pos.fees_paid + extra_fee
        gross = pos.realized
        net = gross - total_fees - pos.funding_paid
        r = net / pos.initial_risk if pos.initial_risk > 0 else np.nan
        trades.append(Trade(
            symbol=pos.symbol, direction=pos.entry_direction,
            entry_ts=pos.entry_ts, exit_ts=self.panel.index[i],
            entry_price=pos.entry_price, exit_price=exit_price, qty=abs(pos.peak_qty),
            gross_pnl=gross, fees=total_fees, funding=pos.funding_paid, net_pnl=net,
            r_multiple=r, exit_reason=reason, bars_held=i - pos.entry_idx,
            is_cascade=pos.is_cascade))

    def _default_stop(self, i: int, j: int, direction: float, price: float) -> float:
        a = self.atr[i, j]
        if not np.isfinite(a) or a <= 0:
            a = price * 0.02
        return price - direction * self.default_stop_atr * a

    # ==================================================================
    # Sorties : stop, sortie temporelle
    # ==================================================================
    def _resolve_exits(self, positions: dict[str, Position], i: int, cash: float,
                       trades: list[Trade],
                       blocked: dict[str, tuple[int, int]]) -> tuple[float, int, float]:
        fees = 0.0
        closed = 0
        for sym in list(positions.keys()):
            pos = positions[sym]
            j = self.symbols.index(sym)
            if not self.valid[i, j]:
                continue
            direction = np.sign(pos.qty)
            hit, price = self._stop_hit(i, j, pos.stop_price, direction)
            reason = None
            if hit:
                reason = "stop"
            elif 0 <= pos.exit_by_idx <= i:
                price = self.close[i, j]
                reason = "time_exit"
            if reason is None:
                continue
            if reason == "stop":
                blocked[sym] = (int(direction),
                                i + int(self.stop_rearm_max_hours * self.bars_per_hour))
            cash, fee = self._close_position(positions, sym, i, price, cash, trades, reason)
            fees += fee
            closed += 1
        return cash, closed, fees

    def _stop_hit(self, i: int, j: int, stop: float, direction: float) -> tuple[bool, float]:
        """Le stop est-il touche dans la barre ? Descente en 1m si necessaire."""
        if not np.isfinite(stop):
            return False, np.nan
        if direction > 0:
            if self.low[i, j] > stop:
                return False, np.nan
        else:
            if self.high[i, j] < stop:
                return False, np.nan
        d = self.panel.data[self.symbols[j]]
        if len(d.m1_slice) > i:
            a, b = d.m1_slice[i]
            if b > a:
                lows, highs = d.m1_low[a:b], d.m1_high[a:b]
                idx = np.argmax(lows <= stop) if direction > 0 else np.argmax(highs >= stop)
                touched = (lows <= stop).any() if direction > 0 else (highs >= stop).any()
                if not touched:
                    return False, np.nan
                opens = d.m1_open[a:b]
                # gap a l'ouverture de la minute : on est rempli au pire
                px = min(opens[idx], stop) if direction > 0 else max(opens[idx], stop)
                return True, float(px)
        # sans 1m : hypothese pessimiste, remplissage au stop degrade par l'ecart
        gap = self.low[i, j] if direction > 0 else self.high[i, j]
        px = min(stop, gap) if direction > 0 else max(stop, gap)
        return True, float(px)

    def _close_position(self, positions: dict[str, Position], sym: str, i: int,
                        price: float, cash: float, trades: list[Trade],
                        reason: str) -> tuple[float, float]:
        pos = positions.pop(sym)
        j = self.symbols.index(sym)
        ct = self.ct_val[sym]
        side = -int(np.sign(pos.qty))
        fill = self.fills.execute_taker(
            side, -pos.qty, price, ct,
            self.atr_frac[i, j] if np.isfinite(self.atr_frac[i, j]) else 0.0,
            max(self.vq[i, j], 1.0), self.vol_ratio[i, j])
        gross = pos.qty * ct * (fill.price - pos.entry_price)
        cash += gross - fill.fee
        pos.realized += gross
        self._record(trades, pos, i, fill.price, reason, extra_fee=fill.fee)
        return cash, fill.fee

    def _flatten_all(self, positions: dict[str, Position], i: int, cash: float,
                     trades: list[Trade], reason: str) -> tuple[float, float]:
        fees = 0.0
        for sym in list(positions.keys()):
            j = self.symbols.index(sym)
            cash, fee = self._close_position(positions, sym, i, self.close[i, j],
                                             cash, trades, reason)
            fees += fee
        return cash, fees

    # ==================================================================
    # Liquidation (marge croisee, sur mark price)
    # ==================================================================
    def _check_liquidation(self, positions: dict[str, Position], i: int, cash: float,
                           trades: list[Trade]) -> tuple[float, int, float]:
        if not positions:
            return cash, 0, 0.0
        # borne pessimiste : tous les actifs a leur extreme defavorable
        worst_equity = cash
        maint = 0.0
        for sym, pos in positions.items():
            j = self.symbols.index(sym)
            ct = self.ct_val[sym]
            adverse = self.mark_lo[i, j] if pos.qty > 0 else self.mark_hi[i, j]
            if not np.isfinite(adverse):
                adverse = self.mark[i, j]
            worst_equity += pos.qty * ct * (adverse - pos.entry_price)
            maint += self.mmr * abs(pos.qty) * ct * adverse
        if worst_equity > maint:
            return cash, 0, 0.0

        # scenario possible : on descend en 1 minute pour dater l'evenement
        minute_idx = self._first_liquidation_minute(positions, i, cash)
        if minute_idx is None:
            return cash, 0, 0.0
        fees = 0.0
        for sym in list(positions.keys()):
            j = self.symbols.index(sym)
            px = self._minute_price(j, i, minute_idx)
            px *= (1.0 - self.liq_penalty * np.sign(positions[sym].qty))
            cash, fee = self._close_position(positions, sym, i, px, cash, trades,
                                             "liquidation")
            fees += fee
        log.info("liquidation a %s (equity residuelle %.0f)", self.panel.index[i], cash)
        return cash, 1, fees

    def _first_liquidation_minute(self, positions: dict[str, Position], i: int,
                                  cash: float) -> int | None:
        slices = {}
        length = 0
        for sym in positions:
            j = self.symbols.index(sym)
            d = self.panel.data[sym]
            if len(d.m1_slice) <= i:
                return 0
            a, b = d.m1_slice[i]
            if b <= a:
                return 0
            slices[sym] = (j, a, b)
            length = max(length, b - a)
        if length == 0:
            return 0
        for t in range(length):
            equity = cash
            maint = 0.0
            for sym, pos in positions.items():
                j, a, b = slices[sym]
                d = self.panel.data[sym]
                k = min(a + t, b - 1)
                px = d.m1_low[k] if pos.qty > 0 else d.m1_high[k]
                ct = self.ct_val[sym]
                equity += pos.qty * ct * (px - pos.entry_price)
                maint += self.mmr * abs(pos.qty) * ct * px
            if equity <= maint:
                return t
        return None

    def _minute_price(self, j: int, i: int, t: int) -> float:
        d = self.panel.data[self.symbols[j]]
        a, b = d.m1_slice[i]
        if b <= a:
            return float(self.close[i, j])
        return float(d.m1_close[min(a + t, b - 1)])

    # ==================================================================
    # Funding
    # ==================================================================
    def _settle_funding(self, positions: dict[str, Position], i: int) -> float:
        if not self.funding_enabled:
            return 0.0
        total = 0.0
        for sym, pos in positions.items():
            j = self.symbols.index(sym)
            rate = self.fund[i, j]
            if rate == 0.0 or not np.isfinite(rate):
                continue
            notional = pos.qty * self.ct_val[sym] * self.mark[i, j]
            paid = notional * rate       # long paie quand le taux est positif
            pos.funding_paid += paid
            total += paid
        return total

    def _apply_funding_guard(self, positions: dict[str, Position], i: int,
                             working: list[WorkingOrder]) -> None:
        """Si le funding paye ronge plus de 30 % du PnL latent, on reduit."""
        for sym, pos in positions.items():
            j = self.symbols.index(sym)
            unreal = pos.qty * self.ct_val[sym] * (self.mark[i, j] - pos.entry_price)
            if unreal <= 0 or pos.funding_paid <= 0:
                continue
            if pos.funding_paid > self.funding_guard * unreal:
                cut = abs(pos.qty) * self.funding_guard_red
                if cut > 0:
                    working.append(WorkingOrder(
                        symbol=sym, side=-int(np.sign(pos.qty)), qty=cut,
                        limit=self.mark[i, j], placed_idx=i, is_cascade=pos.is_cascade,
                        stop_price=pos.stop_price, exit_by_idx=pos.exit_by_idx,
                        reducing=True))

    # ==================================================================
    # Emission des ordres
    # ==================================================================
    def _emit_orders(self, targets: Targets, positions: dict[str, Position], i: int,
                     equity: float, netting_log: list[dict],
                     blocked: dict[str, tuple[int, int]],
                     working: list[WorkingOrder]) -> list[WorkingOrder]:
        orders: list[WorkingOrder] = []
        # Un « emplacement » est occupe par un symbole qui detient deja une
        # position hors cascade OU qui a un ordre d'ouverture en carnet. Sans
        # compter les ordres en carnet, plusieurs ouvertures simultanees
        # passaient chacune le controle et le plafond etait franchi.
        committed: set[str] = {sym for sym, p in positions.items() if not p.is_cascade}
        committed |= {o.symbol for o in working
                      if o.symbol not in positions and not o.is_cascade}
        # les signaux les plus forts obtiennent les places disponibles
        order_by_strength = sorted(
            range(len(self.symbols)),
            key=lambda jj: -abs(targets.weights[i, jj] if np.isfinite(targets.weights[i, jj])
                                else 0.0))
        for j in order_by_strength:
            sym = self.symbols[j]
            if not self.valid[i, j]:
                continue
            w = targets.weights[i, j] * self.leverage
            if not np.isfinite(w):
                w = 0.0
            price = self.close[i, j]
            ct = self.ct_val[sym]
            pos = positions.get(sym)
            cur_qty = pos.qty if pos else 0.0
            cur_w = cur_qty * ct * price / equity if equity > 0 else 0.0

            # re-armement apres stop : le blocage tombe des que le signal
            # change de sens, revient a zero, ou que la duree maximale expire
            blk = blocked.get(sym)
            if blk is not None:
                blocked_dir, until = blk
                if np.sign(w) != blocked_dir or i >= until:
                    blocked.pop(sym, None)
                elif positions.get(sym) is None:
                    netting_log.append({"datetime": self.panel.index[i], "symbol": sym,
                                        "event": "entree_bloquee_apres_stop",
                                        "reason": "rearmement", "target_weight": w})
                    continue

            is_cascade = bool(targets.cascade[i, j])
            stop = targets.stops[i, j]
            if not np.isfinite(stop):
                # Le stop est ENREGISTRE A L'OUVERTURE et ne bouge plus (§9).
                # Le recalculer a chaque rebalancement en ferait un stop suiveur
                # errant autour du prix, declenche par le bruit et non par
                # l'invalidation de la these.
                if pos is not None and np.sign(w) == np.sign(pos.qty) and w != 0.0:
                    stop = pos.stop_price
                elif w != 0.0:
                    stop = self._default_stop(i, j, np.sign(w), price)

            # Le deadband anti-churn du §5 est applique DANS la brique, sur le
            # signal normalise dans [-1, +1], seule echelle ou le seuil de 0.20
            # a un sens. Ici ne subsiste que le filtre anti-poussiere.
            if w == 0.0 and cur_qty == 0.0:
                continue

            target_qty = w * equity / (ct * price) if price > 0 else 0.0

            # -- plafond risk-based : la taille decoule de la distance au stop
            if w != 0.0 and np.isfinite(stop):
                max_qty = self.risk.size_from_stop(equity, price, stop, ct)
                if abs(target_qty) > max_qty:
                    target_qty = np.sign(target_qty) * max_qty

            delta = target_qty - cur_qty
            if abs(delta) * ct * price < equity * self.min_order_fraction:
                continue    # ordre trop petit : le cout depasserait l'interet

            reducing = abs(target_qty) < abs(cur_qty) or (
                cur_qty != 0 and np.sign(target_qty) != np.sign(cur_qty)
                and abs(delta) <= abs(cur_qty))

            gross_after = self._gross_notional(positions, i, override=(sym, target_qty))
            loss_at_stop = abs(target_qty) * ct * abs(price - stop) if np.isfinite(stop) else np.inf
            opening = pos is None and abs(target_qty) > 0
            n_after = len(committed | ({sym} if opening and not is_cascade else set()))
            ok, why = self.risk.approve_order(
                equity=equity, gross_notional_after=gross_after,
                loss_at_stop=loss_at_stop, has_stop=np.isfinite(stop),
                n_positions_after=n_after, is_cascade=is_cascade, is_reducing=reducing)
            if not ok:
                netting_log.append({"datetime": self.panel.index[i], "symbol": sym,
                                    "event": "ordre_refuse", "reason": why,
                                    "target_weight": w})
                continue

            if opening and not is_cascade:
                committed.add(sym)
            side = int(np.sign(delta))
            orders.append(WorkingOrder(
                symbol=sym, side=side, qty=abs(delta),
                limit=self.fills.maker_limit_price(side, price, self.tick[sym]),
                placed_idx=i + 1, is_cascade=is_cascade, stop_price=stop,
                exit_by_idx=int(targets.exit_by[i, j]), reducing=reducing))
        return orders

    # ==================================================================
    def _unrealized(self, positions: dict[str, Position], i: int) -> float:
        total = 0.0
        for sym, pos in positions.items():
            j = self.symbols.index(sym)
            px = self.mark[i, j]
            if not np.isfinite(px):
                px = self.close[i, j]
            total += pos.qty * self.ct_val[sym] * (px - pos.entry_price)
        return total

    def _gross_notional(self, positions: dict[str, Position], i: int,
                        override: tuple[str, float] | None = None) -> float:
        total = 0.0
        for sym, pos in positions.items():
            qty = override[1] if override and override[0] == sym else pos.qty
            j = self.symbols.index(sym)
            total += abs(qty) * self.ct_val[sym] * self.close[i, j]
        if override and override[0] not in positions:
            j = self.symbols.index(override[0])
            total += abs(override[1]) * self.ct_val[override[0]] * self.close[i, j]
        return total
