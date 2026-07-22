"""Nettoyage des OHLCV bruts.

Principe d'honnêteté : on SUPPRIME ce qui n'est pas tradable (marché fermé,
doublons), on RÉPARE les incohérences mécaniques (high/low), mais on ne lisse
jamais les prix — les mèches violentes et les gaps font partie du marché et
doivent coûter au backtest ce qu'ils coûteraient en réel.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class CleaningStats:
    rows_in: int
    rows_out: int
    dropped_closed: int      # bougies plates à volume nul (marché fermé)
    dropped_duplicates: int
    dropped_invalid: int     # prix <= 0 ou NaN
    fixed_hl: int            # high/low incohérents réparés
    max_gap_hours: float     # plus long trou hors week-end


def clean_ohlcv(df: pd.DataFrame, timeframe_hours: float = 1.0) -> tuple[pd.DataFrame, CleaningStats]:
    rows_in = len(df)
    df = df.sort_index()

    dup = df.index.duplicated(keep="last")
    df = df[~dup]

    invalid = (
        df[["open", "high", "low", "close"]].le(0).any(axis=1)
        | df[["open", "high", "low", "close"]].isna().any(axis=1)
    )
    df = df[~invalid]

    # Marché fermé : volume nul ET bougie parfaitement plate.
    flat = (df["open"] == df["close"]) & (df["high"] == df["low"]) & (df["open"] == df["high"])
    closed = flat & (df.get("volume", pd.Series(0.0, index=df.index)) == 0)
    df = df[~closed]

    # Répare high/low incohérents (arrondis de flux) sans toucher open/close.
    oc_max = df[["open", "close"]].max(axis=1)
    oc_min = df[["open", "close"]].min(axis=1)
    bad_h = df["high"] < oc_max
    bad_l = df["low"] > oc_min
    fixed = int(bad_h.sum() + bad_l.sum())
    if fixed:
        df = df.copy()
        df.loc[bad_h, "high"] = oc_max[bad_h]
        df.loc[bad_l, "low"] = oc_min[bad_l]

    if "spread" in df.columns:
        df = df.copy()
        med = float(df["spread"].median())
        df["spread"] = df["spread"].fillna(med).clip(lower=0.0)

    # Trous hors week-end (vendredi soir -> dimanche soir est normal).
    gaps = df.index.to_series().diff().dt.total_seconds().div(3600.0)
    weekend = df.index.dayofweek == 6  # bougie de reprise du dimanche
    intraweek_gaps = gaps[~weekend]
    max_gap = float(intraweek_gaps.max()) if len(intraweek_gaps) else 0.0
    big = intraweek_gaps[intraweek_gaps > 6 * timeframe_hours]
    for ts, g in big.items():
        log.warning("Trou de %.1f h avant %s (hors week-end)", g, ts)

    stats = CleaningStats(
        rows_in=rows_in,
        rows_out=len(df),
        dropped_closed=int(closed.sum()),
        dropped_duplicates=int(dup.sum()),
        dropped_invalid=int(invalid.sum()),
        fixed_hl=fixed,
        max_gap_hours=max_gap,
    )
    return df, stats
