"""Optional crypto data fetch via ccxt (OKX by default). Paginates and caches."""

from __future__ import annotations

import logging
import time
from pathlib import Path

import pandas as pd

from quantbt.data.cleaning import clean_ohlcv

logger = logging.getLogger(__name__)

_TF_MAP = {"15min": "15m", "1h": "1h", "4h": "4h", "1D": "1d"}


def fetch_ohlcv(
    exchange_id: str,
    symbol: str,
    timeframe: str,
    start: str | None = None,
    end: str | None = None,
    cache_dir: str | Path | None = "data/cache",
    limit: int = 300,
) -> pd.DataFrame:
    """Fetch OHLCV candles, paginating forward from ``start``.

    Results are cached as CSV so repeated runs don't hammer the exchange.
    """
    import ccxt  # imported lazily: optional dependency

    tf = _TF_MAP.get(timeframe, timeframe)
    cache_file = None
    if cache_dir is not None:
        safe = f"{exchange_id}_{symbol.replace('/', '-').replace(':', '_')}_{tf}_{start}_{end}.csv"
        cache_file = Path(cache_dir) / safe
        if cache_file.exists():
            logger.info("loading cached %s", cache_file)
            df = pd.read_csv(cache_file, index_col=0, parse_dates=True)
            df.index = pd.DatetimeIndex(df.index).tz_localize("UTC") if df.index.tz is None else df.index
            return clean_ohlcv(df)

    ex = getattr(ccxt, exchange_id)({"enableRateLimit": True})
    since = int(pd.Timestamp(start, tz="UTC").timestamp() * 1000) if start else None
    end_ms = int(pd.Timestamp(end, tz="UTC").timestamp() * 1000) if end else None

    rows: list[list[float]] = []
    while True:
        batch = ex.fetch_ohlcv(symbol, tf, since=since, limit=limit)
        if not batch:
            break
        rows.extend(batch)
        last = batch[-1][0]
        if len(batch) < limit or (end_ms is not None and last >= end_ms):
            break
        since = last + 1
        time.sleep(ex.rateLimit / 1000)

    df = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df.index = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df = df.drop(columns=["timestamp"])
    if end_ms is not None:
        df = df[df.index <= pd.Timestamp(end, tz="UTC")]
    df = clean_ohlcv(df)
    if cache_file is not None and not df.empty:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(cache_file)
    return df
