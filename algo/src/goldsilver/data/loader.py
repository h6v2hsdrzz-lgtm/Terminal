"""Chargement des CSV OHLCV vers des DataFrames validés, indexés en UTC.

Format CSV attendu (produit par ``goldsilver fetch`` ou fourni par
l'utilisateur) : colonnes ``time, open, high, low, close, volume[, spread]``,
horodatage ISO-8601 en UTC, une ligne par bougie du timeframe de base.
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from goldsilver.config import Config
from goldsilver.data.cleaning import CleaningStats, clean_ohlcv

log = logging.getLogger(__name__)

REQUIRED_COLUMNS = ("open", "high", "low", "close", "volume")

TIMEFRAME_HOURS: dict[str, float] = {"15m": 0.25, "1h": 1.0, "4h": 4.0, "1d": 24.0}


def load_asset_csv(path: Path, timeframe: str) -> tuple[pd.DataFrame, CleaningStats]:
    if not path.exists():
        raise FileNotFoundError(
            f"CSV introuvable : {path}. Lancez `goldsilver fetch` ou placez vos "
            "propres données (colonnes: time,open,high,low,close,volume[,spread])."
        )
    df = pd.read_csv(path, parse_dates=["time"], index_col="time")
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    else:
        df.index = df.index.tz_convert("UTC")
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"{path} : colonnes manquantes {missing}")
    df = df[[c for c in (*REQUIRED_COLUMNS, "spread") if c in df.columns]].astype("float64")
    return clean_ohlcv(df, TIMEFRAME_HOURS.get(timeframe, 1.0))


def load_market(
    cfg: Config,
    start: str | pd.Timestamp | None = None,
    end: str | pd.Timestamp | None = None,
) -> dict[str, pd.DataFrame]:
    """Charge tous les actifs configurés, bornés sur [start, end]."""
    start = start if start is not None else cfg.data.start
    end = end if end is not None else cfg.data.end
    out: dict[str, pd.DataFrame] = {}
    for name, spec in cfg.data.assets.items():
        df, stats = load_asset_csv(cfg.resolve(spec.csv), cfg.data.base_timeframe)
        if start is not None:
            df = df[df.index >= pd.Timestamp(start, tz="UTC")]
        if end is not None:
            df = df[df.index <= pd.Timestamp(end, tz="UTC")]
        if df.empty:
            raise ValueError(f"{name} : aucune bougie dans la fenêtre demandée")
        log.info(
            "%s : %d bougies %s -> %s (fermées:%d, doublons:%d, invalides:%d, h/l réparés:%d)",
            name, len(df), df.index[0], df.index[-1],
            stats.dropped_closed, stats.dropped_duplicates, stats.dropped_invalid, stats.fixed_hl,
        )
        out[name] = df
    return out
