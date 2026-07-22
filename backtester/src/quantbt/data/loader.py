"""Data loading: local CSV OHLCV and optional ccxt fetch, multi-TF assembly."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from quantbt.config import DataConfig
from quantbt.data.cleaning import clean_ohlcv
from quantbt.data.resample import align_multi_tf, resample_ohlcv

_COL_ALIASES = {
    "time": "timestamp", "date": "timestamp", "datetime": "timestamp",
    "o": "open", "h": "high", "l": "low", "c": "close", "v": "volume", "vol": "volume",
}


@dataclass
class MarketData:
    """Base-timeframe OHLCV plus lookahead-safe higher-TF columns.

    ``frame`` holds base OHLCV columns and, for each extra timeframe, columns
    suffixed ``_<tf>`` (e.g. ``close_1h``) that only reflect CLOSED HTF bars.
    """

    frame: pd.DataFrame
    base_timeframe: str
    extra_timeframes: tuple[str, ...] = field(default_factory=tuple)

    def with_frame(self, frame: pd.DataFrame) -> "MarketData":
        return MarketData(frame, self.base_timeframe, self.extra_timeframes)


def load_csv(path: str | Path, tz: str = "UTC") -> pd.DataFrame:
    """Load an OHLCV CSV with flexible column names into a clean UTC frame."""
    df = pd.read_csv(path)
    df.columns = [
        _COL_ALIASES.get(c.strip().lower(), c.strip().lower()) for c in df.columns
    ]
    if "timestamp" not in df.columns:
        raise ValueError(f"{path}: no timestamp/date column found")
    ts = df["timestamp"]
    if pd.api.types.is_numeric_dtype(ts):
        unit = "ms" if ts.iloc[0] > 1e11 else "s"
        idx = pd.to_datetime(ts, unit=unit, utc=True)
    else:
        idx = pd.to_datetime(ts, utc=True)
    df.index = pd.DatetimeIndex(idx).tz_convert(tz)
    return clean_ohlcv(df)


def build_market_data(base_df: pd.DataFrame, cfg: DataConfig) -> MarketData:
    """Slice, then attach higher-timeframe columns to the base frame."""
    df = base_df
    if cfg.start:
        df = df[df.index >= pd.Timestamp(cfg.start, tz=cfg.tz)]
    if cfg.end:
        df = df[df.index <= pd.Timestamp(cfg.end, tz=cfg.tz)]
    frame = df.copy()
    for tf in cfg.extra_timeframes:
        ht = resample_ohlcv(df, tf)
        frame = align_multi_tf(frame, ht, tf, suffix=f"_{tf}")
    return MarketData(frame, cfg.base_timeframe, tuple(cfg.extra_timeframes))


def load_data(cfg: DataConfig) -> MarketData:
    """Entry point used by the CLI: CSV or ccxt depending on config."""
    if cfg.source == "csv":
        base = load_csv(cfg.csv_path, cfg.tz)
    elif cfg.source == "ccxt":
        from quantbt.data.ccxt_loader import fetch_ohlcv

        base = fetch_ohlcv(cfg.exchange, cfg.symbol, cfg.base_timeframe, cfg.start, cfg.end)
    else:
        raise ValueError(f"unknown data source: {cfg.source}")
    return build_market_data(base, cfg)
