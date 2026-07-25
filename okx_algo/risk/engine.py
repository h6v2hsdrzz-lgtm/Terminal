"""Moteur de risque (§9).

Deux mecanismes distincts, volontairement separes :

  * APPLICATION — `approve_order` / `halt_state` refusent ou reduisent avant
    execution, et declenchent les mises a plat. C'est la logique normale.
  * VERIFICATION — `assert_invariants` relit l'etat reel du compte apres coup
    et LEVE une exception si une borne est franchie. Si cette exception se
    declenche, c'est que l'application a un bug : le backtest s'arrete, on ne
    poursuit pas sur un resultat fausse.

Toutes les bornes temporelles sont en UTC et alignees sur les cycles de funding.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np
import pandas as pd


class RiskInvariantViolation(RuntimeError):
    """Une borne dure a ete franchie : l'application du risque est defaillante."""


class KillSwitchTriggered(RuntimeError):
    """Arret definitif : -40 % du high-water mark. Reset manuel uniquement."""


@dataclass
class RiskLimits:
    leverage_effective_max: float
    max_concurrent_positions: int
    cascade_slot: int
    daily_dd_stop: float
    weekly_dd_stop: float
    monthly_dd_stop: float
    global_kill_switch: float
    risk_per_trade: float
    stop_loss_required: bool
    funding_cost_guard: float
    funding_guard_reduction: float

    @classmethod
    def from_config(cls, cfg) -> "RiskLimits":
        g = cfg.get
        return cls(
            leverage_effective_max=g("risk.leverage_effective_max"),
            max_concurrent_positions=g("risk.max_concurrent_positions"),
            cascade_slot=g("risk.cascade_slot"),
            daily_dd_stop=g("risk.daily_dd_stop"),
            weekly_dd_stop=g("risk.weekly_dd_stop"),
            monthly_dd_stop=g("risk.monthly_dd_stop"),
            global_kill_switch=g("risk.global_kill_switch"),
            risk_per_trade=g("risk.risk_per_trade"),
            stop_loss_required=g("risk.stop_loss_required"),
            funding_cost_guard=g("risk.funding_cost_guard"),
            funding_guard_reduction=g("risk.funding_guard_reduction"),
        )


@dataclass
class PeriodTracker:
    """High-water mark et budget de perte residuel d'une periode."""
    key: object = None
    hwm: float = 0.0
    start_equity: float = 0.0

    def roll(self, key: object, equity: float) -> bool:
        if key != self.key:
            self.key = key
            self.hwm = equity
            self.start_equity = equity
            return True
        self.hwm = max(self.hwm, equity)
        return False

    def drawdown(self, equity: float) -> float:
        return equity / self.hwm - 1.0 if self.hwm > 0 else 0.0

    def residual_budget(self, equity: float, limit: float) -> float:
        """Perte encore autorisee avant d'atteindre la borne de la periode."""
        floor = self.hwm * (1.0 + limit)     # limit est negatif
        return max(equity - floor, 0.0)


@dataclass
class RiskState:
    halted_until: pd.Timestamp | None = None
    halt_reason: str = ""
    killed: bool = False
    day: PeriodTracker = field(default_factory=PeriodTracker)
    week: PeriodTracker = field(default_factory=PeriodTracker)
    month: PeriodTracker = field(default_factory=PeriodTracker)
    global_hwm: float = 0.0
    events: list = field(default_factory=list)


class RiskEngine:
    def __init__(self, limits: RiskLimits, strict: bool = True):
        self.limits = limits
        self.strict = strict
        self.state = RiskState()

    # ------------------------------------------------------------------
    def start(self, equity: float, ts: pd.Timestamp) -> None:
        self.state.global_hwm = equity
        self.state.day.roll(_day_key(ts), equity)
        self.state.week.roll(_week_key(ts), equity)
        self.state.month.roll(_month_key(ts), equity)

    # ------------------------------------------------------------------
    def update(self, ts: pd.Timestamp, equity: float) -> str | None:
        """Met a jour les high-water marks et retourne l'action requise.

        Retourne None, ou 'flat_day' / 'flat_week' / 'flat_month' / 'kill'.
        """
        st = self.state
        st.day.roll(_day_key(ts), equity)
        st.week.roll(_week_key(ts), equity)
        st.month.roll(_month_key(ts), equity)
        st.global_hwm = max(st.global_hwm, equity)

        if st.killed:
            return "kill"

        global_dd = equity / st.global_hwm - 1.0 if st.global_hwm > 0 else 0.0
        if global_dd <= self.limits.global_kill_switch:
            st.killed = True
            self._log(ts, "kill_switch", global_dd)
            return "kill"

        if st.month.drawdown(equity) <= self.limits.monthly_dd_stop:
            self._halt(ts, _next_month(ts), "monthly_dd_stop")
            return "flat_month"
        if st.week.drawdown(equity) <= self.limits.weekly_dd_stop:
            self._halt(ts, _next_monday(ts), "weekly_dd_stop")
            return "flat_week"
        if st.day.drawdown(equity) <= self.limits.daily_dd_stop:
            self._halt(ts, _next_day(ts), "daily_dd_stop")
            return "flat_day"
        return None

    def _halt(self, ts: pd.Timestamp, until: pd.Timestamp, reason: str) -> None:
        st = self.state
        if st.halted_until is not None and st.halted_until >= until:
            return
        st.halted_until = until
        st.halt_reason = reason
        self._log(ts, reason, float(until.timestamp()))

    def _log(self, ts, kind: str, value: float) -> None:
        self.state.events.append({"datetime": ts, "event": kind, "value": value})

    def is_halted(self, ts: pd.Timestamp) -> bool:
        st = self.state
        if st.killed:
            return True
        if st.halted_until is None:
            return False
        if ts >= st.halted_until:
            st.halted_until = None
            st.halt_reason = ""
            return False
        return True

    # ------------------------------------------------------------------
    def residual_risk_budget(self, equity: float) -> float:
        """min du budget residuel jour / semaine / mois."""
        st = self.state
        return min(
            st.day.residual_budget(equity, self.limits.daily_dd_stop),
            st.week.residual_budget(equity, self.limits.weekly_dd_stop),
            st.month.residual_budget(equity, self.limits.monthly_dd_stop),
        )

    def max_risk_per_trade(self, equity: float) -> float:
        """risque_par_trade = min(1 % x equity, budget residuel de la periode)."""
        return min(self.limits.risk_per_trade * equity, self.residual_risk_budget(equity))

    # ------------------------------------------------------------------
    def approve_order(self, *, equity: float, gross_notional_after: float,
                      loss_at_stop: float, has_stop: bool,
                      n_positions_after: int, is_cascade: bool,
                      is_reducing: bool) -> tuple[bool, str]:
        """Autorisation avant execution. Une reduction n'est jamais refusee."""
        if is_reducing:
            return True, ""
        if self.state.killed:
            return False, "kill_switch"
        if self.limits.stop_loss_required and not has_stop:
            return False, "stop_loss_manquant"
        lev = gross_notional_after / equity if equity > 0 else np.inf
        if lev > self.limits.leverage_effective_max + 1e-9:
            return False, "levier_effectif_max"
        cap = self.limits.max_concurrent_positions + (self.limits.cascade_slot if is_cascade else 0)
        if n_positions_after > cap:
            return False, "positions_simultanees_max"
        budget = self.max_risk_per_trade(equity)
        if loss_at_stop > budget + 1e-9:
            return False, "budget_de_risque_epuise"
        return True, ""

    def size_from_stop(self, equity: float, entry: float, stop: float,
                       ct_val: float) -> float:
        """Sizing risk-based : la taille decoule de la distance au stop."""
        dist = abs(entry - stop)
        if dist <= 0:
            return 0.0
        budget = self.max_risk_per_trade(equity)
        return budget / (dist * ct_val)

    # ------------------------------------------------------------------
    def assert_invariants(self, *, ts, equity: float, gross_notional: float,
                          n_positions: int, n_cascade: int,
                          positions_without_stop: int) -> None:
        """Verification a posteriori. Ne doit jamais se declencher."""
        if not self.strict:
            return
        lim = self.limits
        if equity > 0:
            lev = gross_notional / equity
            if lev > lim.leverage_effective_max * (1 + 1e-6):
                raise RiskInvariantViolation(
                    f"{ts}: levier effectif {lev:.3f} > {lim.leverage_effective_max}")
        if n_positions - n_cascade > lim.max_concurrent_positions:
            raise RiskInvariantViolation(
                f"{ts}: {n_positions - n_cascade} positions hors cascade > "
                f"{lim.max_concurrent_positions}")
        if n_cascade > lim.cascade_slot:
            raise RiskInvariantViolation(f"{ts}: {n_cascade} positions cascade > {lim.cascade_slot}")
        if lim.stop_loss_required and positions_without_stop > 0:
            raise RiskInvariantViolation(f"{ts}: {positions_without_stop} position(s) sans stop")
        if self.state.killed and n_positions > 0:
            raise RiskInvariantViolation(f"{ts}: positions ouvertes apres kill switch")


# ----------------------------------------------------------------------
def _day_key(ts: pd.Timestamp):
    return (ts.year, ts.month, ts.day)


def _week_key(ts: pd.Timestamp):
    iso = ts.isocalendar()
    return (iso[0], iso[1])


def _month_key(ts: pd.Timestamp):
    return (ts.year, ts.month)


def _next_day(ts: pd.Timestamp) -> pd.Timestamp:
    return (ts.normalize() + pd.Timedelta(days=1))


def _next_monday(ts: pd.Timestamp) -> pd.Timestamp:
    return (ts.normalize() + pd.Timedelta(days=7 - ts.weekday()))


def _next_month(ts: pd.Timestamp) -> pd.Timestamp:
    y, m = (ts.year + 1, 1) if ts.month == 12 else (ts.year, ts.month + 1)
    return pd.Timestamp(dt.datetime(y, m, 1), tz="UTC")
