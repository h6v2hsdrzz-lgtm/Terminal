"""Multi-timeframe resampling and lookahead-safe alignment."""

from __future__ import annotations

import pandas as pd

_AGG = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}


def resample_ohlcv(df: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Resample OHLCV bars to a coarser timeframe (e.g. '1h', '1D')."""
    out = df.resample(timeframe, label="left", closed="left").agg(_AGG)
    return out.dropna(subset=["open"])


def align_multi_tf(
    base: pd.DataFrame, higher: pd.DataFrame, timeframe: str, suffix: str
) -> pd.DataFrame:
    """Join a higher-timeframe frame onto the base index without lookahead.

    A higher-TF bar becomes visible only once it has CLOSED: bar [10:00, 11:00)
    is usable from the first base bar at/after 11:00. This is enforced by
    shifting the HTF timestamps to their close time before an asof-join.
    """
    ht = higher.copy()
    ht.index = ht.index + pd.tseries.frequencies.to_offset(timeframe)
    ht = ht.add_suffix(suffix)
    out = pd.merge_asof(
        base, ht, left_index=True, right_index=True, direction="backward"
    )
    return out
