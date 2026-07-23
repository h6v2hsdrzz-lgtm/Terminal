"""Stratégies price-action/SMC : pas de look-ahead + signaux sur cas construits."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from goldsilver.data.timeframes import build_timeframes
from goldsilver.strategy.base import get_strategy
from tests.conftest import random_walk_ohlcv

STRATS = ["excessive_candle_reversion", "gap_fill", "fair_value_gap", "liquidity_sweep"]


def _tfs(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    return build_timeframes(df, "1h", ("1h", "4h", "1d"), -2)


@pytest.mark.parametrize("name", STRATS)
def test_no_lookahead_invariance(name: str) -> None:
    full = random_walk_ohlcv(n=8000, seed=41)
    cut = 6000
    strat = get_strategy(name)
    sig_full = strat.generate("XAUUSD", _tfs(full))
    sig_trunc = strat.generate("XAUUSD", _tfs(full.iloc[:cut]))
    common = sig_full.index.intersection(sig_trunc.index)
    common = common[common < sig_trunc.index[-1]]        # exclut la dernière (bougie 4h partielle)
    pd.testing.assert_series_equal(
        sig_full.loc[common, "signal"], sig_trunc.loc[common, "signal"]
    )


@pytest.mark.parametrize("name", STRATS)
def test_output_columns_and_rr(name: str) -> None:
    df = random_walk_ohlcv(n=3000, seed=7)
    out = get_strategy(name, {"tp_rr": 3.0}).generate("XAUUSD", _tfs(df))
    for col in ("signal", "sl_dist", "tp_dist"):
        assert col in out.columns
    assert set(np.unique(out["signal"])) <= {-1, 0, 1}
    active = out[out["signal"] != 0]
    if len(active):
        # R:R = tp_dist / sl_dist == 3 partout où il y a un signal
        assert np.allclose(active["tp_dist"] / active["sl_dist"], 3.0)


def _frame_4h(rows: list[tuple[float, float, float, float]], spread: float = 0.2) -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=len(rows), freq="4h", tz="UTC")
    o, h, l, c = zip(*rows)
    return pd.DataFrame({"open": o, "high": h, "low": l, "close": c,
                         "volume": np.ones(len(rows)), "spread": spread}, index=idx)


def test_excessive_candle_fades_direction() -> None:
    # 20 bougies calmes (range 1) puis une bougie haussière énorme (range 20)
    rows = [(100, 100.5, 99.5, 100)] * 30
    rows[29] = (100, 120, 100, 119)                      # bougie haussière excessive
    frame = _frame_4h(rows)
    strat = get_strategy("excessive_candle_reversion",
                         {"timeframe": "4h", "atr_period": 14, "range_atr_mult": 2.0})
    out = strat.generate("XAUUSD", {"4h": frame})
    assert out["signal"].iloc[29] == -1                  # fade la hausse -> short


def test_gap_fill_long_on_gap_down() -> None:
    rows = [(100, 100.5, 99.5, 100)] * 20
    rows.append((90, 90.5, 89.5, 90))                    # gap baissier de ~10
    frame = _frame_4h(rows)
    strat = get_strategy("gap_fill",
                         {"timeframe": "4h", "atr_period": 14, "gap_atr_mult": 1.0})
    out = strat.generate("XAUUSD", {"4h": frame})
    assert out["signal"].iloc[-1] == 1                   # gap down -> long (fill up)


def test_fvg_long_on_bullish_imbalance() -> None:
    rows = [(100, 101, 99, 100)] * 20
    # FVG haussier : la bougie i a low > high de la bougie i-2
    rows.append((101, 102, 100.5, 101.5))                # i-2
    rows.append((103, 104, 102.5, 103.5))                # i-1 (impulsion)
    rows.append((105, 106, 104, 105.5))                  # i : low 104 > high[i-2] 102
    frame = _frame_4h(rows)
    strat = get_strategy("fair_value_gap",
                         {"timeframe": "4h", "atr_period": 14, "min_gap_atr": 0.1,
                          "mode": "continuation"})
    out = strat.generate("XAUUSD", {"4h": frame})
    assert out["signal"].iloc[-1] == 1


def test_liquidity_sweep_short_on_high_sweep() -> None:
    rows = [(100, 101, 99, 100)] * 25                    # plus-haut de swing ~101
    rows.append((101, 105, 100.5, 100.8))                # pique à 105 puis clôture sous 101
    frame = _frame_4h(rows)
    strat = get_strategy("liquidity_sweep",
                         {"timeframe": "4h", "atr_period": 14, "swing_lookback": 20})
    out = strat.generate("XAUUSD", {"4h": frame})
    assert out["signal"].iloc[-1] == -1                  # sweep du haut -> short
