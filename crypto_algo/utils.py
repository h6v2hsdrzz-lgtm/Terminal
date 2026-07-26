"""Utilitaires partagés : temps, timeframes, journalisation, E/S."""

from __future__ import annotations

import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

MS_PER_UNIT = {
    "s": 1_000,
    "m": 60_000,
    "h": 3_600_000,
    "d": 86_400_000,
    "w": 604_800_000,
}

_TF_RE = re.compile(r"^(\d+)([smhdw])$")


def timeframe_to_ms(timeframe: str) -> int:
    """'4h' -> 14400000. Lève ValueError si le format est inconnu."""
    m = _TF_RE.match(timeframe.strip().lower())
    if not m:
        raise ValueError(f"Timeframe invalide : {timeframe!r}")
    return int(m.group(1)) * MS_PER_UNIT[m.group(2)]


def timeframe_to_timedelta(timeframe: str) -> pd.Timedelta:
    return pd.Timedelta(milliseconds=timeframe_to_ms(timeframe))


def timeframe_seconds(timeframe: str) -> float:
    return timeframe_to_ms(timeframe) / 1000.0


def bars_per_year(timeframe: str, days_per_year: int = 365) -> float:
    return days_per_year * 86_400_000 / timeframe_to_ms(timeframe)


def to_utc(value) -> pd.Timestamp | None:
    """Convertit à peu près n'importe quoi en Timestamp UTC (None -> None)."""
    if value is None:
        return None
    ts = pd.Timestamp(value)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.tz_convert("UTC")


def to_ms(value) -> int | None:
    ts = to_utc(value)
    return None if ts is None else int(ts.value // 1_000_000)


def dt_to_ms(values) -> np.ndarray:
    """DatetimeIndex/Series UTC -> tableau d'entiers en millisecondes.

    Ne **jamais** utiliser ``.view("int64")`` pour cela : selon la version de
    pandas, la résolution de stockage est la nanoseconde ou la microseconde, et
    un facteur 1000 silencieux décale toute la série (bug détecté par le test
    d'alignement multi-timeframes, qui produisait des horodatages en 1970 et
    donc une fuite d'information massive).
    """
    if isinstance(values, pd.Series):
        idx = pd.DatetimeIndex(pd.to_datetime(values, utc=True))
    else:
        idx = pd.DatetimeIndex(values)
        if idx.tz is None:
            idx = idx.tz_localize("UTC")
    return idx.tz_convert("UTC").tz_localize(None).values.astype("datetime64[ms]").astype("int64")


def now_utc() -> pd.Timestamp:
    return pd.Timestamp(datetime.now(timezone.utc))


def symbol_slug(symbol: str) -> str:
    """'BTC/USDT:USDT' -> 'BTC-USDT-SWAP-ish' slug de fichier."""
    return symbol.replace("/", "_").replace(":", "_").replace("-", "_")


def base_asset(symbol: str) -> str:
    return symbol.split("/")[0]


def ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def setup_logging(level: str = "INFO", logfile: str | Path | None = None) -> logging.Logger:
    root = logging.getLogger("crypto_algo")
    root.setLevel(getattr(logging, str(level).upper(), logging.INFO))
    root.handlers.clear()
    fmt = logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s")
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)
    if logfile:
        ensure_dir(Path(logfile).parent)
        fh = logging.FileHandler(logfile, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    root.propagate = False
    return root


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"crypto_algo.{name}")


def safe_div(a, b, default=np.nan):
    """Division protégée, compatible scalaires et Series."""
    if isinstance(a, (pd.Series, np.ndarray)) or isinstance(b, (pd.Series, np.ndarray)):
        with np.errstate(divide="ignore", invalid="ignore"):
            out = np.where(np.asarray(b) == 0, default, np.asarray(a) / np.asarray(b))
        if isinstance(a, pd.Series):
            return pd.Series(out, index=a.index)
        if isinstance(b, pd.Series):
            return pd.Series(out, index=b.index)
        return out
    if b == 0 or b is None or (isinstance(b, float) and np.isnan(b)):
        return default
    return a / b


def clip_score(x):
    """Contraint un score dans [-1, +1] (NaN préservés)."""
    if isinstance(x, pd.Series):
        return x.clip(-1.0, 1.0)
    if isinstance(x, np.ndarray):
        return np.clip(x, -1.0, 1.0)
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return np.nan
    return max(-1.0, min(1.0, float(x)))


def tanh_score(x, scale: float = 1.0):
    """Normalisation douce vers [-1, 1] d'une quantité non bornée."""
    return np.tanh(np.asarray(x, dtype=float) / scale) if not isinstance(x, pd.Series) \
        else pd.Series(np.tanh(x.astype(float) / scale), index=x.index)


def rolling_zscore(series: pd.Series, window: int, min_periods: int | None = None) -> pd.Series:
    mp = min_periods if min_periods is not None else max(2, window // 2)
    mean = series.rolling(window, min_periods=mp).mean()
    std = series.rolling(window, min_periods=mp).std(ddof=0)
    return (series - mean) / std.replace(0.0, np.nan)


def rolling_percentile_rank(series: pd.Series, window: int, min_periods: int | None = None) -> pd.Series:
    """Rang percentile de la dernière valeur dans sa fenêtre glissante (0..1)."""
    mp = min_periods if min_periods is not None else max(2, window // 5)
    return series.rolling(window, min_periods=mp).apply(
        lambda w: (w[:-1] <= w[-1]).mean() if len(w) > 1 else np.nan, raw=True
    )


def utc_index(df: pd.DataFrame, column: str = "timestamp") -> pd.DataFrame:
    """Indexe un DataFrame par un DatetimeIndex UTC issu d'une colonne ms."""
    out = df.copy()
    out.index = pd.to_datetime(out[column], unit="ms", utc=True)
    out.index.name = "dt"
    return out


def period_key(ts: pd.Timestamp, period: str, week_start: str = "monday") -> str:
    """Clé de période UTC utilisée par les coupe-circuits de drawdown."""
    ts = to_utc(ts)
    if period == "day":
        return ts.strftime("%Y-%m-%d")
    if period == "week":
        offset = ts.weekday() if week_start == "monday" else (ts.weekday() + 1) % 7
        monday = (ts - pd.Timedelta(days=offset)).normalize()
        return monday.strftime("W%Y-%m-%d")
    if period == "month":
        return ts.strftime("%Y-%m")
    raise ValueError(f"Période inconnue : {period!r}")


def chunked(iterable: Iterable, size: int):
    buf = []
    for item in iterable:
        buf.append(item)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf
