"""exit_signal du moteur, levier par actif, et smoke des nouvelles stratégies."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from goldsilver.config import AssetSpec
from goldsilver.engine.backtester import Backtester
from goldsilver.engine.sizing import position_size
from goldsilver.strategy.base import get_strategy
from goldsilver.data.timeframes import build_timeframes
from tests.conftest import make_bars, random_walk_ohlcv

FLAT = (100.0, 100.5, 99.5, 100.0)


def test_exit_signal_closes_at_next_open(make_cfg) -> None:
    bt = Backtester(make_cfg())
    bars = make_bars([FLAT] * 6, signal=[1, 0, 0, 0, 0, 0])
    bars["exit_signal"] = [0, 0, 1, 0, 0, 0]     # émis à la clôture de la bougie 2
    res = bt.run({"XAUUSD": bars})
    t = res.trades[0]
    assert t.reason == "signal"
    assert t.exit_time == bars.index[3]           # exécuté à l'ouverture suivante
    assert math.isclose(t.exit, 100.0)            # open, spread/slippage nuls


def test_gap_sl_has_priority_over_exit_signal(make_cfg) -> None:
    bt = Backtester(make_cfg())
    bars = make_bars(
        [FLAT, FLAT, FLAT, (90, 92, 89, 91), FLAT],
        signal=[1, 0, 0, 0, 0],
    )
    bars["exit_signal"] = [0, 0, 1, 0, 0]
    res = bt.run({"XAUUSD": bars})
    t = res.trades[0]
    # l'ouverture gap sous le SL (95) : le stop part avant l'ordre de sortie
    assert t.reason == "sl"
    assert math.isclose(t.exit, 90.0)


def test_per_asset_leverage_cap() -> None:
    spec = AssetSpec(csv="x", contract_size=1.0, min_size=1.0, size_step=1.0,
                     max_leverage=10.0)
    # risque énorme -> borne par le levier ACTIF (10x) avant le global (20x)
    d = position_size(10_000, 1.0, 5.0, price=100.0, spec=spec, max_leverage=20.0)
    assert d.units == 1000.0                      # 10 000 x 10 / 100
    spec2 = AssetSpec(csv="x", contract_size=1.0, min_size=1.0, size_step=1.0,
                      max_leverage=None)
    d2 = position_size(10_000, 1.0, 5.0, price=100.0, spec=spec2, max_leverage=20.0)
    assert d2.units == 2000.0                     # seul le global s'applique


def _pair_market() -> dict[str, dict[str, pd.DataFrame]]:
    n = 4000
    rng = np.random.default_rng(9)
    idx = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    common = np.cumsum(rng.normal(0, 0.002, n))
    spread_osc = 0.08 * np.sin(np.arange(n) / 120.0)   # écart mean-reverting
    a = 2000.0 * np.exp(common + spread_osc / 2)
    b = 25.0 * np.exp(common - spread_osc / 2)

    def ohlc(close: np.ndarray) -> pd.DataFrame:
        open_ = np.concatenate([[close[0]], close[:-1]])
        return pd.DataFrame(
            {"open": open_, "high": np.maximum(open_, close) * 1.0005,
             "low": np.minimum(open_, close) * 0.9995, "close": close,
             "volume": np.full(n, 10.0)},
            index=idx,
        )

    return {
        "XAUUSD": build_timeframes(ohlc(a), "1h", ("1h", "1d"), -2),
        "XAGUSD": build_timeframes(ohlc(b), "1h", ("1h", "1d"), -2),
    }


def test_ratio_strategy_emits_opposite_legs_and_exits() -> None:
    strat = get_strategy("ratio_reversion", {"z_window": 240, "z_entry": 1.5})
    signals = strat.generate_all(_pair_market())
    sa, sb = signals["XAUUSD"], signals["XAGUSD"]
    entries = sa["signal"] != 0
    assert entries.any(), "aucune entrée générée sur un écart oscillant"
    # jambes strictement opposées sur chaque bougie d'entrée
    assert (sa.loc[entries, "signal"] == -sb.loc[entries, "signal"]).all()
    assert (sa["exit_signal"] == sb["exit_signal"]).all()
    assert sa["exit_signal"].sum() > 0


def test_ratio_strategy_requires_generate_all() -> None:
    strat = get_strategy("ratio_reversion")
    with pytest.raises(NotImplementedError):
        strat.generate("XAUUSD", {})


def test_daily_breakout_long_only_no_lookahead() -> None:
    full = random_walk_ohlcv(n=6000, seed=21)
    cut = 4000
    strat = get_strategy("daily_breakout", {"donchian_n": 10, "trend_ema": 20})

    def signals(df: pd.DataFrame) -> pd.DataFrame:
        return strat.generate("XAUUSD", build_timeframes(df, "1h", ("1h", "1d"), -2))

    sig_full = signals(full).iloc[:cut]
    sig_trunc = signals(full.iloc[:cut])
    pd.testing.assert_series_equal(sig_full["signal"], sig_trunc["signal"])
    assert set(np.unique(sig_full["signal"])) <= {0, 1}   # long-only par défaut


def test_generate_all_default_matches_per_asset() -> None:
    market = {
        "XAUUSD": build_timeframes(random_walk_ohlcv(n=3000, seed=1), "1h", ("1h", "1d"), -2),
        "XAGUSD": build_timeframes(random_walk_ohlcv(n=3000, seed=2, s0=25.0), "1h", ("1h", "1d"), -2),
    }
    strat = get_strategy("trend_pullback", {"trend_ema": 10})
    all_ = strat.generate_all(market)
    for a in market:
        pd.testing.assert_frame_equal(all_[a], strat.generate(a, market[a]))
