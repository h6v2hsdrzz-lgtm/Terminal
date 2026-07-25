"""Chaque contrainte de risque a un test dédié, avec un scénario synthétique
qui **prouve son déclenchement** (critère d'acceptation §12).
"""

from __future__ import annotations

import pandas as pd
import pytest

from crypto_algo.config import load_config
from crypto_algo.risk.engine import RiskEngine
from crypto_algo.risk.exceptions import OrderRejected, RiskInvariantViolation


class FakePosition:
    def __init__(self, symbol="BTC/USDT:USDT", margin=1000.0, leverage=10.0,
                 stop_loss=100.0, opened_at=None, side="long", quantity=1.0, entry_price=1000.0):
        self.symbol = symbol
        self.margin = margin
        self.leverage = leverage
        self.stop_loss = stop_loss
        self.opened_at = opened_at or pd.Timestamp("2024-01-01", tz="UTC")
        self.side = side
        self.quantity = quantity
        self.entry_price = entry_price


@pytest.fixture()
def engine():
    cfg = load_config(overrides={"risk.initial_equity": 10_000.0})
    eng = RiskEngine(cfg)
    eng.start(pd.Timestamp("2024-01-01 00:00", tz="UTC"), 10_000.0)
    return eng


# --------------------------------------------------------------- levier max
def test_leverage_never_exceeds_max(engine):
    """Le levier effectif reste <= 10 quelle que soit la distance au stop."""
    for stop_pct in (0.004, 0.01, 0.02, 0.05, 0.09):
        sizing = engine.size_position(10_000, 1000.0, 1000.0 * (1 - stop_pct), "long")
        assert sizing.leverage <= engine.leverage_max + 1e-9
        assert sizing.margin <= 0.20 * 10_000 + 1e-6


def test_invariant_raises_on_excessive_leverage(engine):
    pos = FakePosition(leverage=12.0)
    with pytest.raises(RiskInvariantViolation, match="levier"):
        engine.on_tick(pd.Timestamp("2024-01-01 01:00", tz="UTC"), 10_000.0, [pos])


# --------------------------------------------------- marge maximale / trade
def test_stop_too_tight_is_rejected(engine):
    with pytest.raises(OrderRejected) as exc:
        engine.size_position(10_000, 1000.0, 999.0, "long")   # 0.1 % < min 0.3 %
    assert exc.value.code == "stop_too_tight"


def test_margin_cap_enforced_on_tight_but_valid_stop(engine):
    sizing = engine.size_position(10_000, 1000.0, 1000.0 * (1 - 0.0035), "long")
    assert sizing.margin <= 0.20 * 10_000 + 1e-6
    # le plafond de marge a mordu : le risque effectif est inférieur au risque cible
    assert sizing.risk_pct <= engine.risk_per_trade + 1e-12


# ------------------------------------------------ positions simultanées max
def test_max_concurrent_positions(engine):
    positions = [FakePosition(symbol="A"), FakePosition(symbol="B")]
    decision = engine.validate_order(
        pd.Timestamp("2024-01-01 02:00", tz="UTC"), "C", "long", 1000.0, 980.0, 10_000.0, positions
    )
    assert not decision.approved and decision.code == "max_positions"


def test_invariant_raises_on_too_many_positions(engine):
    positions = [FakePosition(symbol=s) for s in ("A", "B", "C")]
    with pytest.raises(RiskInvariantViolation, match="positions ouvertes"):
        engine.on_tick(pd.Timestamp("2024-01-01 02:00", tz="UTC"), 10_000.0, positions)


def test_one_position_per_symbol(engine):
    positions = [FakePosition(symbol="BTC/USDT:USDT")]
    decision = engine.validate_order(
        pd.Timestamp("2024-01-01 02:00", tz="UTC"), "BTC/USDT:USDT", "long",
        1000.0, 980.0, 10_000.0, positions,
    )
    assert not decision.approved and decision.code == "symbol_taken"


# --------------------------------------------------------- stop obligatoire
def test_stop_loss_is_mandatory(engine):
    with pytest.raises(OrderRejected) as exc:
        engine.size_position(10_000, 1000.0, None, "long")
    assert exc.value.code == "no_stop"


def test_invariant_raises_on_position_without_stop(engine):
    pos = FakePosition(stop_loss=None)
    with pytest.raises(RiskInvariantViolation, match="sans stop loss"):
        engine.on_tick(pd.Timestamp("2024-01-01 03:00", tz="UTC"), 10_000.0, [pos])


def test_stop_on_wrong_side_is_rejected(engine):
    with pytest.raises(OrderRejected) as exc:
        engine.size_position(10_000, 1000.0, 1050.0, "long")
    assert exc.value.code == "stop_wrong_side"


# ------------------------------------------------------- drawdown journalier
def test_daily_drawdown_stop_triggers_and_halts_until_midnight(engine):
    ts = pd.Timestamp("2024-01-01 10:00", tz="UTC")
    actions = engine.on_tick(ts, 9_500.0, [])          # -5 % : pas encore
    assert not actions
    actions = engine.on_tick(ts + pd.Timedelta(hours=1), 9_390.0, [])   # -6.1 %
    assert any(a.startswith("flatten_and_halt:day") for a in actions)
    halted, reason = engine.is_halted()
    assert halted and "day" in reason
    # ordre refusé tant que la halte est active
    decision = engine.validate_order(ts + pd.Timedelta(hours=2), "BTC", "long", 100.0, 98.0, 9_390.0)
    assert not decision.approved and decision.code == "halted"
    # levée à minuit
    engine.on_tick(pd.Timestamp("2024-01-02 00:00", tz="UTC"), 9_390.0, [])
    assert not engine.is_halted()[0]


def test_weekly_drawdown_stop_halts_until_monday(engine):
    ts = pd.Timestamp("2024-01-03 12:00", tz="UTC")     # mercredi
    actions = engine.on_tick(ts, 8_400.0, [])           # -16 %
    assert any(a.startswith("flatten_and_halt:week") for a in actions)
    assert engine.halts["week"].until == pd.Timestamp("2024-01-08 00:00", tz="UTC")


def test_monthly_drawdown_stop_halts_until_first_of_next_month(engine):
    ts = pd.Timestamp("2024-01-15 12:00", tz="UTC")
    actions = engine.on_tick(ts, 7_400.0, [])           # -26 %
    assert any(a.startswith("flatten_and_halt:month") for a in actions)
    assert engine.halts["month"].until == pd.Timestamp("2024-02-01 00:00", tz="UTC")


# ------------------------------------------------------------- kill switch
def test_global_kill_switch_is_permanent(engine):
    engine.on_tick(pd.Timestamp("2024-01-01 06:00", tz="UTC"), 12_000.0, [])   # HWM = 12 000
    actions = engine.on_tick(pd.Timestamp("2024-01-02 06:00", tz="UTC"), 4_700.0, [])  # -60.8 %
    assert any(a.startswith("flatten_and_halt:global") for a in actions)
    assert engine.killed
    # même un mois plus tard, aucun ordre ne passe
    decision = engine.validate_order(
        pd.Timestamp("2024-03-01 00:00", tz="UTC"), "BTC", "long", 100.0, 98.0, 4_700.0
    )
    assert not decision.approved


# ---------------------------------------------------------- verrou de profit
def test_profit_lock_arms_at_38_pct_and_stops_at_25_pct(engine):
    engine.on_tick(pd.Timestamp("2024-01-10 00:00", tz="UTC"), 13_900.0, [])   # +39 %
    assert engine.periods["month"].profit_lock_armed
    actions = engine.on_tick(pd.Timestamp("2024-01-12 00:00", tz="UTC"), 12_400.0, [])  # +24 %
    assert any("profit_lock" in a for a in actions)
    assert engine.halts["month"].active
    assert engine.halts["month"].until == pd.Timestamp("2024-02-01 00:00", tz="UTC")


def test_profit_lock_not_armed_below_trigger(engine):
    engine.on_tick(pd.Timestamp("2024-01-10 00:00", tz="UTC"), 13_500.0, [])   # +35 %
    assert not engine.periods["month"].profit_lock_armed
    actions = engine.on_tick(pd.Timestamp("2024-01-12 00:00", tz="UTC"), 12_400.0, [])
    assert not any("profit_lock" in a for a in actions)


def test_monthly_take_profit_at_110_pct(engine):
    actions = engine.on_tick(pd.Timestamp("2024-01-20 00:00", tz="UTC"), 21_500.0, [])  # +115 %
    assert any("monthly_take_profit" in a for a in actions)
    assert engine.halts["month"].active


# ---------------------------------------------------------- budget de risque
def test_residual_risk_budget_shrinks_after_losses(engine):
    engine.on_tick(pd.Timestamp("2024-01-01 08:00", tz="UTC"), 9_600.0, [])   # -4 %
    assert engine.residual_budget("day") == pytest.approx(0.02, abs=1e-9)
    sizing = engine.size_position(9_600.0, 1000.0, 980.0, "long")
    assert sizing.risk_pct <= 0.02 + 1e-12


def test_order_refused_when_daily_budget_exhausted(engine):
    """Perte de 5 % dans la journée + 1 % déjà risqué sur une position ouverte :
    il ne reste rien du budget journalier, la deuxième position est refusée."""
    engine.on_tick(pd.Timestamp("2024-01-01 08:00", tz="UTC"), 9_500.0, [])   # -5 %
    with pytest.raises(OrderRejected) as exc:
        engine.size_position(9_500.0, 1000.0, 980.0, "long", open_risk_pct=0.01)
    assert exc.value.code == "no_risk_budget"


def test_size_shrinks_as_budget_nears_exhaustion(engine):
    """Budget presque épuisé : la taille est réduite, pas arrondie au risque cible."""
    engine.on_tick(pd.Timestamp("2024-01-01 08:00", tz="UTC"), 9_450.0, [])   # -5.5 %
    sizing = engine.size_position(9_450.0, 1000.0, 980.0, "long")
    assert sizing.risk_pct == pytest.approx(0.005, abs=1e-9)
    assert sizing.risk_pct < engine.risk_per_trade


def test_open_risk_reduces_available_budget(engine):
    """Le risque déjà engagé consomme le budget : deux positions à 1,5 % ne
    peuvent pas coexister avec un budget résiduel de 1 %."""
    engine.on_tick(pd.Timestamp("2024-01-01 08:00", tz="UTC"), 9_500.0, [])   # -5 %
    residual = engine.residual_budget("day", open_risk_pct=0.008)
    assert residual == pytest.approx(0.002, abs=1e-9)


# ------------------------------------------------------ sizing risk-based §6.1
def test_position_size_is_risk_based_not_margin_based(engine):
    """Le risque au stop vaut risk_per_trade × equity, indépendamment du levier."""
    equity = 10_000.0
    for stop_pct in (0.005, 0.01, 0.02, 0.04):
        s = engine.size_position(equity, 1000.0, 1000.0 * (1 - stop_pct), "long")
        loss_at_stop = s.quantity * (1000.0 - 1000.0 * (1 - stop_pct))
        expected = min(engine.risk_per_trade * equity, s.risk_amount)
        assert loss_at_stop == pytest.approx(expected, rel=1e-6)


def test_liquidation_stays_beyond_stop(engine):
    """Invariant §6.1 : la liquidation ne doit jamais précéder le stop."""
    for stop_pct in (0.005, 0.01, 0.03, 0.06, 0.09):
        entry, stop = 1000.0, 1000.0 * (1 - stop_pct)
        s = engine.size_position(10_000, entry, stop, "long")
        assert s.liquidation_price < stop, f"liq {s.liquidation_price} >= stop {stop}"
        decision = engine.validate_order(
            pd.Timestamp("2024-01-01 09:00", tz="UTC"), "BTC", "long", entry, stop, 10_000
        )
        assert decision.approved


def test_short_liquidation_stays_beyond_stop(engine):
    for stop_pct in (0.005, 0.02, 0.06):
        entry, stop = 1000.0, 1000.0 * (1 + stop_pct)
        s = engine.size_position(10_000, entry, stop, "short")
        assert s.liquidation_price > stop


def test_maintenance_margin_tiers_increase_with_notional(engine):
    assert engine.mmr_for_notional(10_000) <= engine.mmr_for_notional(500_000)
    assert engine.mmr_for_notional(500_000) <= engine.mmr_for_notional(50_000_000)


# ------------------------------------------------------ durée de détention
def test_holding_beyond_max_days_is_an_invariant_violation(engine):
    pos = FakePosition(opened_at=pd.Timestamp("2024-01-01", tz="UTC"))
    with pytest.raises(RiskInvariantViolation, match="détenue"):
        engine.on_tick(pd.Timestamp("2024-01-07 00:00", tz="UTC"), 10_000.0, [pos])


def test_negative_equity_is_an_invariant_violation(engine):
    with pytest.raises(RiskInvariantViolation, match="equity négative"):
        engine.on_tick(pd.Timestamp("2024-01-02 00:00", tz="UTC"), -5.0, [])


# ------------------------------------------------------- références de DD
def test_drawdown_reference_hwm_vs_period_start():
    """Les deux références sont journalisées ; celle qui déclenche est paramétrable."""
    cfg_hwm = load_config(overrides={"risk.drawdown.reference": "high_water_mark"})
    cfg_start = load_config(overrides={"risk.drawdown.reference": "period_start"})
    ts0 = pd.Timestamp("2024-01-01 00:00", tz="UTC")
    e_hwm, e_start = RiskEngine(cfg_hwm), RiskEngine(cfg_start)
    for eng in (e_hwm, e_start):
        eng.start(ts0, 10_000.0)
        eng.on_tick(ts0 + pd.Timedelta(hours=1), 11_000.0, [])   # HWM 11 000
    a_hwm = e_hwm.on_tick(ts0 + pd.Timedelta(hours=2), 10_300.0, [])   # -6.4 % vs HWM, +3 % vs début
    a_start = e_start.on_tick(ts0 + pd.Timedelta(hours=2), 10_300.0, [])
    assert any("day" in a for a in a_hwm)
    assert not a_start
