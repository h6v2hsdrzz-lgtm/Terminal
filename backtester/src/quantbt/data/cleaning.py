"""OHLCV cleaning: duplicates, NaN, and OHLC consistency."""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

OHLCV_COLS = ["open", "high", "low", "close", "volume"]


def clean_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """Return a cleaned copy: sorted UTC index, no duplicates, valid OHLC.

    Rows with NaN prices are dropped; missing volume becomes 0. Bars where
    high < low or where open/close fall outside [low, high] are clamped and
    logged — silently corrupt bars are the main source of phantom SL/TP fills.
    """
    df = df.copy()
    df = df[~df.index.duplicated(keep="first")].sort_index()
    df = df.dropna(subset=["open", "high", "low", "close"])
    df["volume"] = df.get("volume", pd.Series(0.0, index=df.index)).fillna(0.0)

    bad = (df["high"] < df["low"]).sum()
    if bad:
        logger.warning("%d bars with high < low, swapping", bad)
        hi = df[["high", "low"]].max(axis=1)
        lo = df[["high", "low"]].min(axis=1)
        df["high"], df["low"] = hi, lo

    df["high"] = np.maximum.reduce([df["high"], df["open"], df["close"]])
    df["low"] = np.minimum.reduce([df["low"], df["open"], df["close"]])
    return df[OHLCV_COLS]
