"""Cache Parquet local : écriture atomique, fusion incrémentale, lecture bornée."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from ..utils import ensure_dir, get_logger, symbol_slug, to_ms

log = get_logger("data.store")

OHLCV_COLUMNS = ["timestamp", "open", "high", "low", "close", "volume"]


class ParquetStore:
    """Arborescence :

    ``<root>/ohlcv/<slug>/<timeframe>.parquet``
    ``<root>/mark/<slug>/<timeframe>.parquet``
    ``<root>/index/<slug>/<timeframe>.parquet``
    ``<root>/funding/<slug>.parquet``
    ``<root>/open_interest/<slug>.parquet``
    """

    def __init__(self, root: str | Path):
        self.root = ensure_dir(root)

    # ------------------------------------------------------------------ paths
    def path(self, kind: str, symbol: str, timeframe: str | None = None) -> Path:
        slug = symbol_slug(symbol)
        if timeframe is None:
            return self.root / kind / f"{slug}.parquet"
        return self.root / kind / slug / f"{timeframe}.parquet"

    def exists(self, kind: str, symbol: str, timeframe: str | None = None) -> bool:
        return self.path(kind, symbol, timeframe).exists()

    # ------------------------------------------------------------------- read
    def read(
        self,
        kind: str,
        symbol: str,
        timeframe: str | None = None,
        start=None,
        end=None,
    ) -> pd.DataFrame:
        p = self.path(kind, symbol, timeframe)
        if not p.exists():
            return pd.DataFrame(columns=["timestamp"])
        df = pd.read_parquet(p)
        if df.empty:
            return df
        df = df.sort_values("timestamp").reset_index(drop=True)
        s_ms, e_ms = to_ms(start), to_ms(end)
        if s_ms is not None:
            df = df[df["timestamp"] >= s_ms]
        if e_ms is not None:
            df = df[df["timestamp"] < e_ms]
        return df.reset_index(drop=True)

    def last_timestamp(self, kind: str, symbol: str, timeframe: str | None = None) -> int | None:
        p = self.path(kind, symbol, timeframe)
        if not p.exists():
            return None
        df = pd.read_parquet(p, columns=["timestamp"])
        return None if df.empty else int(df["timestamp"].max())

    def first_timestamp(self, kind: str, symbol: str, timeframe: str | None = None) -> int | None:
        p = self.path(kind, symbol, timeframe)
        if not p.exists():
            return None
        df = pd.read_parquet(p, columns=["timestamp"])
        return None if df.empty else int(df["timestamp"].min())

    # ------------------------------------------------------------------ write
    def write(self, df: pd.DataFrame, kind: str, symbol: str, timeframe: str | None = None) -> Path:
        """Écriture atomique (tmp + rename) après tri et déduplication."""
        p = self.path(kind, symbol, timeframe)
        ensure_dir(p.parent)
        clean = (
            df.dropna(subset=["timestamp"])
            .drop_duplicates(subset="timestamp", keep="last")
            .sort_values("timestamp")
            .reset_index(drop=True)
        )
        clean["timestamp"] = clean["timestamp"].astype("int64")
        tmp = p.with_suffix(".parquet.tmp")
        clean.to_parquet(tmp, index=False, compression="snappy")
        tmp.replace(p)
        return p

    def merge(self, df: pd.DataFrame, kind: str, symbol: str, timeframe: str | None = None) -> Path:
        """Fusionne un lot avec l'existant. Les nouvelles barres écrasent les anciennes."""
        if df is None or df.empty:
            return self.path(kind, symbol, timeframe)
        existing = self.read(kind, symbol, timeframe)
        if existing.empty:
            merged = df
        else:
            merged = pd.concat([existing, df], ignore_index=True)
        return self.write(merged, kind, symbol, timeframe)

    # ------------------------------------------------------------- inventaire
    def inventory(self) -> pd.DataFrame:
        rows = []
        for p in sorted(self.root.rglob("*.parquet")):
            rel = p.relative_to(self.root)
            kind = rel.parts[0]
            try:
                df = pd.read_parquet(p, columns=["timestamp"])
            except Exception:  # noqa: BLE001
                continue
            rows.append(
                {
                    "kind": kind,
                    "file": str(rel),
                    "rows": len(df),
                    "start": pd.to_datetime(df["timestamp"].min(), unit="ms", utc=True) if len(df) else None,
                    "end": pd.to_datetime(df["timestamp"].max(), unit="ms", utc=True) if len(df) else None,
                    "mb": round(p.stat().st_size / 1e6, 2),
                }
            )
        return pd.DataFrame(rows)
