"""Moteur de risque — contraintes dures (§6).

Les règles ne sont pas des suggestions : ce sont des invariants vérifiés à
chaque tick. Une violation lève une exception et arrête le backtest. Un ordre
non conforme est refusé (et journalisé), il n'est jamais « arrondi » pour
passer.

Sizing : risk-based (§6.1). La taille découle du risque au stop, pas de la
marge. Le plafond de 20 % de marge reste un plafond **secondaire**.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

import pandas as pd

from ..config import Config
from ..utils import get_logger, period_key, to_utc
from .exceptions import KillSwitchTriggered, OrderRejected, RiskInvariantViolation

log = get_logger("risk.engine")

PERIODS = ("day", "week", "month")


# ---------------------------------------------------------------------------
# Structures d'état
# ---------------------------------------------------------------------------
@dataclass
class PeriodState:
    """Ancrage d'une période (jour / semaine / mois) en UTC."""

    key: str
    start_equity: float
    hwm: float
    start_ts: pd.Timestamp
    realized_pnl: float = 0.0
    trades: int = 0
    profit_lock_armed: bool = False

    def drawdown(self, equity: float, reference: str) -> float:
        """Drawdown de la période, selon la référence choisie."""
        if reference == "period_start":
            base = self.start_equity
        elif reference == "high_water_mark":
            base = self.hwm
        elif reference == "worst_of":
            base = max(self.hwm, self.start_equity)
        else:
            raise ValueError(f"Référence de drawdown inconnue : {reference!r}")
        if base <= 0:
            return 0.0
        return equity / base - 1.0

    def pnl_pct(self, equity: float) -> float:
        if self.start_equity <= 0:
            return 0.0
        return equity / self.start_equity - 1.0


@dataclass
class Halt:
    active: bool = False
    until: pd.Timestamp | None = None
    reason: str = ""
    scope: str = ""
    permanent: bool = False


@dataclass
class SizingResult:
    quantity: float
    notional: float
    margin: float
    leverage: float
    risk_amount: float
    risk_pct: float
    stop_distance_pct: float
    liquidation_price: float


@dataclass
class RiskDecision:
    approved: bool
    reason: str = ""
    code: str = "ok"
    sizing: SizingResult | None = None


@dataclass
class RiskEvent:
    ts: pd.Timestamp
    kind: str            # halt | unhalt | reject | kill | profit_lock | take_profit
    scope: str           # day | week | month | global | order
    reason: str
    equity: float
    detail: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Moteur
# ---------------------------------------------------------------------------
class RiskEngine:
    def __init__(self, cfg: Config, initial_equity: float | None = None):
        self.cfg = cfg
        r = cfg.sub("risk")
        self.leverage_max = float(r["leverage_max"])
        self.max_margin_per_trade = float(r["max_margin_per_trade"])
        self.max_total_margin = float(r["max_total_margin"])
        self.max_concurrent = int(r["max_concurrent_positions"])
        self.max_per_symbol = int(r["max_positions_per_symbol"])
        self.max_holding_days = float(r["max_holding_days"])
        self.sizing_mode = str(r["sizing_mode"])
        self.risk_per_trade = float(r["risk_per_trade"])
        self.min_stop_pct = float(r["min_stop_distance_pct"])
        self.max_stop_pct = float(r["max_stop_distance_pct"])
        self.min_notional = float(r["min_notional"])
        self.require_sl = bool(r["require_stop_loss"])
        self.enforce = bool(r["enforce_invariants"])

        dd = r["drawdown"]
        self.dd_reference = str(dd["reference"])
        self.limits = {
            "day": float(dd["daily_dd_stop"]),
            "week": float(dd["weekly_dd_stop"]),
            "month": float(dd["monthly_dd_stop"]),
        }
        self.kill_switch = float(dd["global_kill_switch"])
        self.week_start = str(dd.get("week_start", "monday"))

        budget = r["risk_budget"]
        self.budget_enabled = bool(budget.get("enabled", True))
        self.budgets = {
            "day": abs(float(budget["daily"])),
            "week": abs(float(budget["weekly"])),
            "month": abs(float(budget["monthly"])),
        }
        pl = r["profit_lock"]
        self.profit_lock_enabled = bool(pl["enabled"])
        self.profit_lock_trigger = float(pl["trigger"])
        self.profit_lock_floor = float(pl["floor"])
        self.monthly_take_profit = float(r["monthly_take_profit"])

        liq = cfg.get_path("execution.liquidation", {}) or {}
        self.liq_buffer = float(r.get("liquidation_buffer", 1.5))
        self.taker_fee = float(cfg.get_path("execution.fees.taker"))
        self._mmr_tiers = liq.get("tiers") or [{"max_notional": None, "mmr": 0.005}]

        self.initial_equity = float(
            initial_equity if initial_equity is not None else r["initial_equity"]
        )
        self.reset()

    # ------------------------------------------------------------------ état
    def reset(self) -> None:
        self.equity = self.initial_equity
        self.hwm_global = self.initial_equity
        self.periods: dict[str, PeriodState] = {}
        self.halts: dict[str, Halt] = {p: Halt(scope=p) for p in PERIODS}
        self.halts["global"] = Halt(scope="global")
        self.killed = False
        self.events: list[RiskEvent] = []
        self._started = False

    # --------------------------------------------------------------- helpers
    def mmr_for_notional(self, notional: float) -> float:
        for tier in self._mmr_tiers:
            cap = tier.get("max_notional")
            if cap is None or notional <= float(cap):
                return float(tier["mmr"])
        return float(self._mmr_tiers[-1]["mmr"])

    def _period_boundary_end(self, ts: pd.Timestamp, period: str) -> pd.Timestamp:
        ts = to_utc(ts)
        if period == "day":
            return ts.normalize() + pd.Timedelta(days=1)
        if period == "week":
            offset = ts.weekday() if self.week_start == "monday" else (ts.weekday() + 1) % 7
            monday = (ts - pd.Timedelta(days=offset)).normalize()
            return monday + pd.Timedelta(days=7)
        if period == "month":
            return (ts.normalize().replace(day=1) + pd.Timedelta(days=32)).replace(day=1)
        raise ValueError(period)

    def _log_event(self, ts, kind, scope, reason, detail=None) -> RiskEvent:
        ev = RiskEvent(
            ts=to_utc(ts), kind=kind, scope=scope, reason=reason,
            equity=self.equity, detail=detail or {},
        )
        self.events.append(ev)
        log.info("[risk] %s | %s/%s | %s | equity=%.2f", ev.ts, kind, scope, reason, self.equity)
        return ev

    # ------------------------------------------------------------ cycle de vie
    def start(self, ts: pd.Timestamp, equity: float | None = None) -> None:
        ts = to_utc(ts)
        if equity is not None:
            self.equity = float(equity)
        self.hwm_global = max(self.hwm_global, self.equity)
        for period in PERIODS:
            self.periods[period] = PeriodState(
                key=period_key(ts, period, self.week_start),
                start_equity=self.equity,
                hwm=self.equity,
                start_ts=ts,
            )
        self._started = True

    def _roll_periods(self, ts: pd.Timestamp) -> list[str]:
        """Bascule les ancrages de période. Renvoie la liste des périodes changées."""
        rolled = []
        for period in PERIODS:
            key = period_key(ts, period, self.week_start)
            state = self.periods.get(period)
            if state is None or state.key != key:
                self.periods[period] = PeriodState(
                    key=key, start_equity=self.equity, hwm=self.equity, start_ts=to_utc(ts)
                )
                rolled.append(period)
        return rolled

    # ------------------------------------------------------------------- tick
    def on_tick(
        self,
        ts: pd.Timestamp,
        equity: float,
        positions: Iterable[Any] = (),
        open_risk: float = 0.0,
    ) -> list[str]:
        """Met à jour l'état et renvoie les actions à exécuter par le backtest.

        Actions possibles : ``flatten_and_halt:<scope>:<raison>``, ``kill``.
        Les invariants sont vérifiés ici : toute violation lève une exception.
        """
        ts = to_utc(ts)
        if not self._started:
            self.start(ts, equity)
        self.equity = float(equity)

        rolled = self._roll_periods(ts)
        for period in rolled:
            halt = self.halts[period]
            if halt.active and not halt.permanent and halt.until is not None and ts >= halt.until:
                self.halts[period] = Halt(scope=period)
                self._log_event(ts, "unhalt", period, "nouvelle période, halte levée")

        # levée des haltes expirées (même sans changement de période)
        for period in PERIODS:
            halt = self.halts[period]
            if halt.active and not halt.permanent and halt.until is not None and ts >= halt.until:
                self.halts[period] = Halt(scope=period)
                self._log_event(ts, "unhalt", period, "fin de la fenêtre de halte")

        self.hwm_global = max(self.hwm_global, self.equity)
        for state in self.periods.values():
            state.hwm = max(state.hwm, self.equity)

        self._check_invariants(ts, positions)

        actions: list[str] = []

        # --- kill switch global (sur le HWM global) ---
        global_dd = self.equity / self.hwm_global - 1.0 if self.hwm_global > 0 else 0.0
        if not self.killed and global_dd <= self.kill_switch:
            self.killed = True
            self.halts["global"] = Halt(
                active=True, until=None, reason=f"kill switch {global_dd:.2%}",
                scope="global", permanent=True,
            )
            self._log_event(ts, "kill", "global", f"kill switch atteint ({global_dd:.2%})",
                            {"drawdown": global_dd})
            actions.append(f"flatten_and_halt:global:kill_switch {global_dd:.2%}")
            return actions

        # --- coupe-circuits de drawdown par période ---
        for period in PERIODS:
            if self.halts[period].active:
                continue
            dd = self.periods[period].drawdown(self.equity, self.dd_reference)
            if dd <= self.limits[period]:
                self._activate_halt(ts, period, f"drawdown {period} {dd:.2%} <= {self.limits[period]:.2%}")
                actions.append(f"flatten_and_halt:{period}:drawdown {dd:.2%}")

        # --- verrou de profit / take profit mensuels ---
        month = self.periods["month"]
        pnl_m = month.pnl_pct(self.equity)
        if self.profit_lock_enabled and not self.halts["month"].active:
            if not month.profit_lock_armed and pnl_m >= self.profit_lock_trigger:
                month.profit_lock_armed = True
                self._log_event(ts, "profit_lock", "month",
                                f"verrou armé à {pnl_m:.2%} (seuil {self.profit_lock_trigger:.2%})")
            if month.profit_lock_armed and pnl_m <= self.profit_lock_floor:
                self._activate_halt(ts, "month",
                                    f"restitution : PnL mensuel retombé à {pnl_m:.2%} "
                                    f"(plancher {self.profit_lock_floor:.2%})")
                actions.append(f"flatten_and_halt:month:profit_lock {pnl_m:.2%}")
        if not self.halts["month"].active and pnl_m >= self.monthly_take_profit:
            self._activate_halt(ts, "month", f"take profit mensuel {pnl_m:.2%}")
            actions.append(f"flatten_and_halt:month:monthly_take_profit {pnl_m:.2%}")

        return actions

    def _activate_halt(self, ts: pd.Timestamp, period: str, reason: str) -> None:
        until = self._period_boundary_end(ts, period)
        self.halts[period] = Halt(active=True, until=until, reason=reason, scope=period)
        self._log_event(ts, "halt", period, f"{reason} — halte jusqu'à {until}", {"until": str(until)})

    # ------------------------------------------------------------- invariants
    def _check_invariants(self, ts: pd.Timestamp, positions: Iterable[Any]) -> None:
        if not self.enforce:
            return
        if self.equity < 0:
            raise RiskInvariantViolation(
                f"{ts} equity négative ({self.equity:.2f}) : la liquidation aurait dû intervenir avant"
            )
        positions = list(positions)
        if len(positions) > self.max_concurrent:
            raise RiskInvariantViolation(
                f"{ts} {len(positions)} positions ouvertes > max {self.max_concurrent}"
            )
        per_symbol: dict[str, int] = {}
        total_margin = 0.0
        for pos in positions:
            symbol = getattr(pos, "symbol", "?")
            per_symbol[symbol] = per_symbol.get(symbol, 0) + 1
            if per_symbol[symbol] > self.max_per_symbol:
                raise RiskInvariantViolation(f"{ts} {per_symbol[symbol]} positions sur {symbol}")
            if self.require_sl and not getattr(pos, "stop_loss", None):
                raise RiskInvariantViolation(f"{ts} position {symbol} sans stop loss enregistré")
            lev = float(getattr(pos, "leverage", 0.0))
            if lev > self.leverage_max + 1e-9:
                raise RiskInvariantViolation(
                    f"{ts} levier {lev:.2f} > maximum {self.leverage_max} sur {symbol}"
                )
            total_margin += float(getattr(pos, "margin", 0.0))
            opened = getattr(pos, "opened_at", None)
            if opened is not None and self.max_holding_days > 0:
                held = (to_utc(ts) - to_utc(opened)).total_seconds() / 86400.0
                if held > self.max_holding_days + 1e-6:
                    raise RiskInvariantViolation(
                        f"{ts} position {symbol} détenue {held:.2f} j > max {self.max_holding_days} j"
                    )
        if self.equity > 0 and total_margin > self.equity * (self.max_total_margin + 0.5) :
            # tolérance : la marge est figée à l'entrée, l'equity varie ensuite.
            raise RiskInvariantViolation(
                f"{ts} marge totale {total_margin:.2f} incohérente avec l'equity {self.equity:.2f}"
            )

    # ------------------------------------------------------- budgets de risque
    def period_drawdown(self, period: str) -> float:
        state = self.periods.get(period)
        if state is None:
            return 0.0
        return state.drawdown(self.equity, self.dd_reference)

    def residual_budget(self, period: str, open_risk_pct: float = 0.0) -> float:
        """Budget de risque restant sur la période, en fraction d'equity."""
        if not self.budget_enabled:
            return float("inf")
        dd = min(0.0, self.period_drawdown(period))
        return max(0.0, self.budgets[period] + dd - open_risk_pct)

    def residual_budget_all(self, open_risk_pct: float = 0.0) -> float:
        return min(self.residual_budget(p, open_risk_pct) for p in PERIODS)

    def is_halted(self) -> tuple[bool, str]:
        if self.killed:
            return True, "kill switch global — reset manuel obligatoire"
        for scope, halt in self.halts.items():
            if halt.active:
                return True, f"halte {scope} : {halt.reason}"
        return False, ""

    # ----------------------------------------------------------------- sizing
    def _leverage_for_stop(self, stop_distance_pct: float, notional_guess: float) -> float:
        """Levier tel que le prix de liquidation reste **au-delà** du stop.

        Sans cette contrainte, un stop à 8 % en levier 10 (liquidation ~9,6 %)
        n'a aucune marge de sécurité : la mèche qui touche le stop liquide.
        """
        mmr = self.mmr_for_notional(notional_guess)
        required = stop_distance_pct * self.liq_buffer + mmr + self.taker_fee
        if required <= 0:
            return self.leverage_max
        return max(1.0, min(self.leverage_max, 1.0 / required))

    def liquidation_price(self, side: str, entry: float, quantity: float, margin: float,
                          notional: float | None = None) -> float:
        notional = notional if notional is not None else abs(quantity) * entry
        mmr = self.mmr_for_notional(notional)
        fee = self.taker_fee if bool(self.cfg.get_path("execution.liquidation.taker_fee_buffer", True)) else 0.0
        per_unit_margin = margin / abs(quantity) if quantity else 0.0
        if side == "long":
            return max(0.0, (entry - per_unit_margin) / (1.0 - mmr - fee))
        return (entry + per_unit_margin) / (1.0 + mmr + fee)

    def size_position(
        self,
        equity: float,
        entry_price: float,
        stop_price: float,
        side: str,
        open_risk_pct: float = 0.0,
        risk_per_trade: float | None = None,
    ) -> SizingResult:
        """Dimensionnement risk-based. Lève ``OrderRejected`` si non finançable."""
        if entry_price <= 0:
            raise OrderRejected("prix d'entrée invalide", "bad_price")
        if self.require_sl and (stop_price is None or stop_price <= 0):
            raise OrderRejected("stop loss obligatoire", "no_stop")

        stop_distance = abs(entry_price - stop_price) / entry_price
        if stop_distance < self.min_stop_pct:
            raise OrderRejected(
                f"stop trop proche ({stop_distance:.3%} < {self.min_stop_pct:.3%}) : "
                "le bruit de marché le déclencherait", "stop_too_tight",
            )
        if stop_distance > self.max_stop_pct:
            raise OrderRejected(
                f"stop trop lointain ({stop_distance:.3%} > {self.max_stop_pct:.3%})", "stop_too_wide"
            )
        if (side == "long" and stop_price >= entry_price) or (side == "short" and stop_price <= entry_price):
            raise OrderRejected("stop du mauvais côté du prix d'entrée", "stop_wrong_side")

        base_risk = float(self.risk_per_trade if risk_per_trade is None else risk_per_trade)
        residual = self.residual_budget_all(open_risk_pct)
        risk_pct = min(base_risk, residual)
        if risk_pct <= 1e-9:
            raise OrderRejected(
                f"budget de risque résiduel épuisé (jour {self.residual_budget('day', open_risk_pct):.3%}, "
                f"semaine {self.residual_budget('week', open_risk_pct):.3%}, "
                f"mois {self.residual_budget('month', open_risk_pct):.3%})",
                "no_risk_budget",
            )

        risk_amount = risk_pct * equity
        quantity = risk_amount / (stop_distance * entry_price)
        notional = quantity * entry_price

        # levier compatible avec la distance au stop, puis plafond de marge
        leverage = self._leverage_for_stop(stop_distance, notional)
        margin = notional / leverage
        margin_cap = self.max_margin_per_trade * equity
        if margin > margin_cap:
            scale = margin_cap / margin
            quantity *= scale
            notional *= scale
            margin = margin_cap
            risk_amount *= scale
            risk_pct *= scale
        if notional < self.min_notional:
            raise OrderRejected(
                f"notionnel {notional:.2f} < minimum {self.min_notional}", "below_min_notional"
            )

        liq = self.liquidation_price(side, entry_price, quantity, margin, notional)
        return SizingResult(
            quantity=quantity, notional=notional, margin=margin, leverage=leverage,
            risk_amount=risk_amount, risk_pct=risk_pct, stop_distance_pct=stop_distance,
            liquidation_price=liq,
        )

    # ------------------------------------------------------------ validation
    def validate_order(
        self,
        ts: pd.Timestamp,
        symbol: str,
        side: str,
        entry_price: float,
        stop_price: float,
        equity: float,
        open_positions: Iterable[Any] = (),
        open_risk_pct: float = 0.0,
        risk_per_trade: float | None = None,
    ) -> RiskDecision:
        """Autorise ou refuse une ouverture. Ne lève jamais pour un refus normal."""
        halted, reason = self.is_halted()
        if halted:
            return RiskDecision(False, reason, "halted")

        positions = list(open_positions)
        if len(positions) >= self.max_concurrent:
            return RiskDecision(
                False, f"{len(positions)} positions ouvertes (max {self.max_concurrent})", "max_positions"
            )
        if sum(1 for p in positions if getattr(p, "symbol", None) == symbol) >= self.max_per_symbol:
            return RiskDecision(False, f"position déjà ouverte sur {symbol}", "symbol_taken")

        used_margin = sum(float(getattr(p, "margin", 0.0)) for p in positions)
        try:
            sizing = self.size_position(
                equity, entry_price, stop_price, side,
                open_risk_pct=open_risk_pct, risk_per_trade=risk_per_trade,
            )
        except OrderRejected as exc:
            return RiskDecision(False, exc.reason, exc.code)

        if sizing.leverage > self.leverage_max + 1e-9:
            return RiskDecision(False, f"levier {sizing.leverage:.2f} > {self.leverage_max}", "leverage")
        if sizing.margin > self.max_margin_per_trade * equity + 1e-6:
            return RiskDecision(
                False,
                f"marge {sizing.margin:.2f} > {self.max_margin_per_trade:.0%} de l'equity",
                "margin_per_trade",
            )
        if used_margin + sizing.margin > self.max_total_margin * equity + 1e-6:
            return RiskDecision(
                False,
                f"marge totale {used_margin + sizing.margin:.2f} > {self.max_total_margin:.0%} de l'equity",
                "margin_total",
            )
        # le stop doit rester en deçà de la liquidation
        if side == "long" and sizing.liquidation_price >= stop_price:
            return RiskDecision(
                False,
                f"liquidation ({sizing.liquidation_price:.2f}) avant le stop ({stop_price:.2f})",
                "liq_before_stop",
            )
        if side == "short" and sizing.liquidation_price <= stop_price:
            return RiskDecision(
                False,
                f"liquidation ({sizing.liquidation_price:.2f}) avant le stop ({stop_price:.2f})",
                "liq_before_stop",
            )
        return RiskDecision(True, "ok", "ok", sizing)

    # -------------------------------------------------------------- reporting
    def events_frame(self) -> pd.DataFrame:
        if not self.events:
            return pd.DataFrame(columns=["ts", "kind", "scope", "reason", "equity"])
        return pd.DataFrame(
            [
                {"ts": e.ts, "kind": e.kind, "scope": e.scope, "reason": e.reason, "equity": e.equity}
                for e in self.events
            ]
        )

    def summary(self) -> dict[str, Any]:
        ev = self.events_frame()
        counts = ev["kind"].value_counts().to_dict() if not ev.empty else {}
        return {
            "halts_day": int(((ev.get("kind") == "halt") & (ev.get("scope") == "day")).sum()) if not ev.empty else 0,
            "halts_week": int(((ev.get("kind") == "halt") & (ev.get("scope") == "week")).sum()) if not ev.empty else 0,
            "halts_month": int(((ev.get("kind") == "halt") & (ev.get("scope") == "month")).sum()) if not ev.empty else 0,
            "killed": self.killed,
            "event_counts": counts,
        }
