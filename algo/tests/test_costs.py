"""Spread effectif et swap overnight."""

from __future__ import annotations

import math

import pandas as pd
import pytest

from goldsilver.engine.costs import effective_spread, swap_for_bar


@pytest.fixture
def costs_cfg(make_cfg):
    cfg = make_cfg(engine={"costs": {
        "spread_mode": "from_data",
        "pessimistic_spread_mult": 1.5,
        "per_asset": {"XAUUSD": {"fixed_spread": 0.35, "slippage": 0.1,
                                  "swap_long": -0.6, "swap_short": 0.05}},
    }})
    return cfg.engine.costs


def test_spread_from_data_applies_pessimistic_mult(costs_cfg) -> None:
    assert math.isclose(effective_spread(costs_cfg, "XAUUSD", 0.4), 0.6)


def test_spread_fallback_on_nan_or_zero(costs_cfg) -> None:
    # spread mesuré indisponible -> spread fixe, TOUJOURS majoré en mode from_data
    assert math.isclose(effective_spread(costs_cfg, "XAUUSD", float("nan")), 0.35 * 1.5)
    assert math.isclose(effective_spread(costs_cfg, "XAUUSD", 0.0), 0.35 * 1.5)


def test_spread_fixed_mode(make_cfg) -> None:
    cfg = make_cfg(engine={"costs": {"spread_mode": "fixed",
                                     "pessimistic_spread_mult": 2.0,
                                     "per_asset": {"XAUUSD": {"fixed_spread": 0.35,
                                                              "slippage": 0.1,
                                                              "swap_long": -0.6,
                                                              "swap_short": 0.05}}}})
    # en mode fixed, le multiplicateur pessimiste ne s'applique pas : le spread
    # fixe EST l'hypothèse choisie.
    assert math.isclose(effective_spread(cfg.engine.costs, "XAUUSD", 0.4), 0.35)


def test_swap_charged_only_at_rollover_hour(costs_cfg) -> None:
    ts_roll = pd.Timestamp("2024-01-02 21:00", tz="UTC")   # mardi
    ts_other = pd.Timestamp("2024-01-02 20:00", tz="UTC")
    assert swap_for_bar(costs_cfg, "XAUUSD", 1, 10.0, 1.0, ts_other) == 0.0
    assert math.isclose(swap_for_bar(costs_cfg, "XAUUSD", 1, 10.0, 1.0, ts_roll), -6.0)


def test_swap_triple_wednesday_and_short_sign(costs_cfg) -> None:
    ts_wed = pd.Timestamp("2024-01-03 21:00", tz="UTC")    # mercredi
    assert math.isclose(swap_for_bar(costs_cfg, "XAUUSD", 1, 10.0, 1.0, ts_wed), -18.0)
    assert math.isclose(swap_for_bar(costs_cfg, "XAUUSD", -1, 10.0, 1.0, ts_wed), 1.5)
