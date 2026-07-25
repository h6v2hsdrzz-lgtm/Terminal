"""Stockage Parquet, telechargement incremental, lecture memoisee."""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import pandas as pd

from ..core.persist import atomic_write_bytes


class ParquetStore:
    """Un fichier par (dataset, symbole, timeframe). Ecriture atomique."""

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._mem: dict[str, pd.DataFrame] = {}

    # ------------------------------------------------------------------
    def path(self, dataset: str, symbol: str, timeframe: str | None = None) -> Path:
        sym = symbol.replace("/", "_")
        name = f"{sym}_{timeframe}.parquet" if timeframe else f"{sym}.parquet"
        return self.root / dataset / name

    def exists(self, dataset: str, symbol: str, timeframe: str | None = None) -> bool:
        return self.path(dataset, symbol, timeframe).exists()

    # ------------------------------------------------------------------
    def write(self, df: pd.DataFrame, dataset: str, symbol: str,
              timeframe: str | None = None) -> Path:
        p = self.path(dataset, symbol, timeframe)
        p.parent.mkdir(parents=True, exist_ok=True)
        buf = df.to_parquet(index=False, compression="zstd")
        atomic_write_bytes(p, buf)
        self._mem.pop(str(p), None)
        return p

    def read(self, dataset: str, symbol: str, timeframe: str | None = None,
             cache: bool = True) -> pd.DataFrame:
        p = self.path(dataset, symbol, timeframe)
        if not p.exists():
            raise FileNotFoundError(f"donnee absente: {p}")
        key = str(p)
        if cache and key in self._mem:
            return self._mem[key]
        df = pd.read_parquet(p)
        if "datetime" in df.columns:
            df["datetime"] = pd.to_datetime(df["datetime"], utc=True)
        if cache:
            self._mem[key] = df
        return df

    def try_read(self, dataset: str, symbol: str, timeframe: str | None = None
                 ) -> pd.DataFrame | None:
        try:
            return self.read(dataset, symbol, timeframe)
        except FileNotFoundError:
            return None

    # ------------------------------------------------------------------
    def upsert(self, df: pd.DataFrame, dataset: str, symbol: str,
               timeframe: str | None = None, key: str = "datetime") -> pd.DataFrame:
        """Fusion incrementale : les nouvelles barres remplacent les anciennes."""
        old = self.try_read(dataset, symbol, timeframe)
        if old is not None and len(old):
            merged = pd.concat([old, df], ignore_index=True)
        else:
            merged = df.copy()
        merged = (merged.drop_duplicates(subset=key, keep="last")
                        .sort_values(key)
                        .reset_index(drop=True))
        self.write(merged, dataset, symbol, timeframe)
        return merged

    # ------------------------------------------------------------------
    def coverage(self, dataset: str, symbol: str, timeframe: str | None = None
                 ) -> tuple[pd.Timestamp, pd.Timestamp] | None:
        df = self.try_read(dataset, symbol, timeframe)
        if df is None or not len(df) or "datetime" not in df.columns:
            return None
        return df["datetime"].iloc[0], df["datetime"].iloc[-1]

    def clear_memory(self) -> None:
        self._mem.clear()


def utc(d) -> dt.datetime:
    t = pd.Timestamp(d)
    return (t.tz_localize("UTC") if t.tz is None else t).to_pydatetime()
