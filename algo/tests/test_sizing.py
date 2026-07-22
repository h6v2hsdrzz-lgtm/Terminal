"""Sizing en % de risque : le cœur du risk management, testé à la main."""

from __future__ import annotations

import math

from goldsilver.config import AssetSpec
from goldsilver.engine.sizing import position_size

SPEC = AssetSpec(csv="x.csv", contract_size=1.0, min_size=1.0, size_step=1.0)


def test_risk_pct_basic() -> None:
    # 1 % de 10 000 $ = 100 $ de risque ; SL à 5 $ -> 20 unités.
    d = position_size(10_000, 0.01, 5.0, price=100.0, spec=SPEC)
    assert d.units == 20.0
    assert d.risk_amount == 100.0
    assert d.reason == "ok"


def test_step_rounding_never_rounds_up() -> None:
    spec = AssetSpec(csv="x", contract_size=1.0, min_size=1.0, size_step=10.0)
    d = position_size(10_000, 0.01, 5.1, price=100.0, spec=spec)
    # 100 / 5.1 = 19.6 -> arrondi au pas INFÉRIEUR : 10, jamais 20.
    assert d.units == 10.0
    assert d.risk_amount == 10.0 * 5.1


def test_below_min_size_is_refused() -> None:
    spec = AssetSpec(csv="x", contract_size=1.0, min_size=50.0, size_step=50.0)
    d = position_size(10_000, 0.01, 5.0, price=100.0, spec=spec)  # 20 unités < 50
    assert d.units == 0.0
    assert d.reason == "taille sous le minimum"


def test_invalid_sl_distance_refused() -> None:
    assert position_size(10_000, 0.01, 0.0, price=100.0, spec=SPEC).units == 0.0
    assert position_size(10_000, 0.01, -1.0, price=100.0, spec=SPEC).units == 0.0
    assert position_size(10_000, 0.01, math.nan, price=100.0, spec=SPEC).units == 0.0


def test_zero_or_negative_equity_refused() -> None:
    assert position_size(0.0, 0.01, 5.0, price=100.0, spec=SPEC).units == 0.0
    assert position_size(-50.0, 0.01, 5.0, price=100.0, spec=SPEC).units == 0.0


def test_correlation_factor_halves_risk() -> None:
    d = position_size(10_000, 0.01, 5.0, price=100.0, spec=SPEC, risk_factor=0.5)
    assert d.units == 10.0
    assert d.risk_amount == 50.0


def test_risk_budget_caps_but_never_increases() -> None:
    d = position_size(10_000, 0.01, 5.0, price=100.0, spec=SPEC, risk_budget_left=50.0)
    assert d.units == 10.0
    d2 = position_size(10_000, 0.01, 5.0, price=100.0, spec=SPEC, risk_budget_left=1e9)
    assert d2.units == 20.0  # budget large : la taille reste bornée par risk_pct
    d3 = position_size(10_000, 0.01, 5.0, price=100.0, spec=SPEC, risk_budget_left=0.0)
    assert d3.units == 0.0 and d3.reason == "budget de risque épuisé"


def test_leverage_cap() -> None:
    # risque énorme -> 2000 unités théoriques ; levier 2x sur 10 000 $ à 100 $
    # -> notionnel max 20 000 $ -> 200 unités.
    d = position_size(10_000, 1.0, 5.0, price=100.0, spec=SPEC, max_leverage=2.0)
    assert d.units == 200.0
    # notionnel déjà occupé par une autre position
    d2 = position_size(10_000, 1.0, 5.0, price=100.0, spec=SPEC,
                       max_leverage=2.0, open_notional=15_000.0)
    assert d2.units == 50.0
    d3 = position_size(10_000, 1.0, 5.0, price=100.0, spec=SPEC,
                       max_leverage=2.0, open_notional=25_000.0)
    assert d3.units == 0.0 and d3.reason == "levier max atteint"


def test_contract_size_scales_risk() -> None:
    spec = AssetSpec(csv="x", contract_size=100.0, min_size=0.01, size_step=0.01)
    d = position_size(10_000, 0.01, 5.0, price=100.0, spec=spec)
    # risque par unité = 5 x 100 = 500 $ -> 0.2 unité
    assert math.isclose(d.units, 0.2)
    assert math.isclose(d.risk_amount, 100.0)
