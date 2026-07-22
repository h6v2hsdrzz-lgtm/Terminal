"""Anti-look-ahead : le test le plus important du dépôt.

Deux niveaux :
1. Test unitaire de ``align_to_base`` : une bougie 1h ne voit que la valeur
   de la bougie daily PRÉCÉDENTE (terminée).
2. Test d'invariance de la stratégie complète : les signaux jusqu'à t ne
   changent PAS quand on ajoute des données après t. Si ce test casse, le
   backtest lit le futur.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from goldsilver.data.cleaning import clean_ohlcv
from goldsilver.data.timeframes import align_to_base, build_timeframes, resample_ohlcv
from goldsilver.strategy.base import get_strategy
from tests.conftest import random_walk_ohlcv


def _hourly(n: int, start: str = "2024-01-01") -> pd.DataFrame:
    idx = pd.date_range(start, periods=n, freq="1h", tz="UTC")
    base = np.arange(n, dtype=float) + 100.0
    return pd.DataFrame(
        {"open": base, "high": base + 1, "low": base - 1, "close": base + 0.5,
         "volume": np.ones(n)},
        index=idx,
    )


def test_align_uses_previous_completed_daily_bar() -> None:
    df = _hourly(24 * 5)
    daily = resample_ohlcv(df, "1d")
    aligned = align_to_base(df.index, daily["close"], shift=1)
    # bougie du 3 janvier à 07:00 : ne doit voir que le close daily du 2 janvier
    ts = pd.Timestamp("2024-01-03 07:00", tz="UTC")
    expected = daily.loc[pd.Timestamp("2024-01-02", tz="UTC"), "close"]
    assert aligned.loc[ts] == expected
    # toute la première journée : aucune valeur daily disponible -> NaN
    first_day = aligned[aligned.index < pd.Timestamp("2024-01-02", tz="UTC")]
    assert first_day.isna().all()


def test_aligned_value_lags_at_least_one_day() -> None:
    df = _hourly(24 * 10)
    daily = resample_ohlcv(df, "1d")
    aligned = align_to_base(df.index, daily["close"], shift=1)
    for ts, val in aligned.dropna().items():
        bar_day = ts.normalize()
        source_day = daily.index[daily["close"] == val][0]
        assert source_day < bar_day, f"{ts} voit la valeur du jour {source_day}"


def test_session_offset_attaches_sunday_evening_to_monday() -> None:
    idx = pd.date_range("2024-01-05 00:00", "2024-01-08 23:00", freq="1h", tz="UTC")
    df = pd.DataFrame(
        {"open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 1.0},
        index=idx,
    )
    daily = resample_ohlcv(df, "1d", day_offset_hours=-2)
    # bornes de bougies à 22:00 : la bougie contenant dimanche 23:00 démarre
    # dimanche 22:00 (session du lundi)
    assert pd.Timestamp("2024-01-07 22:00", tz="UTC") in daily.index


def test_strategy_signals_invariant_to_future_data() -> None:
    full = random_walk_ohlcv(n=3000, seed=11)
    cut = 2000
    truncated = full.iloc[:cut]

    strat = get_strategy("trend_pullback", {"trend_ema": 10})

    def signals(df: pd.DataFrame) -> pd.DataFrame:
        tfs = build_timeframes(df, "1h", ("1h", "1d"), day_offset_hours=-2)
        return strat.generate("XAUUSD", tfs)

    sig_full = signals(full).iloc[:cut]
    sig_trunc = signals(truncated)
    pd.testing.assert_series_equal(sig_full["signal"], sig_trunc["signal"])
    pd.testing.assert_series_equal(sig_full["sl_dist"], sig_trunc["sl_dist"])


def test_cleaning_drops_closed_market_bars() -> None:
    df = _hourly(48)
    df.iloc[10, df.columns.get_loc("volume")] = 0.0
    for col in ("open", "high", "low", "close"):
        df.iloc[10, df.columns.get_loc(col)] = 42.0   # bougie plate
    cleaned, stats = clean_ohlcv(df)
    assert stats.dropped_closed == 1
    assert len(cleaned) == 47


def test_cleaning_fixes_inconsistent_high_low() -> None:
    df = _hourly(24)
    df.iloc[5, df.columns.get_loc("high")] = 0.5     # high < max(open, close)
    cleaned, stats = clean_ohlcv(df)
    assert stats.fixed_hl >= 1
    row = cleaned.iloc[5]
    assert row["high"] >= max(row["open"], row["close"])
