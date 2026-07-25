"""Historique profond via les dumps publics data.binance.vision.

Pourquoi cette source : l'API publique OKX ne retient que ~3 mois de funding
et ~1.5 an d'open interest. Or le mandat impose des taux de funding REELS sur
2020-2026 et une detection de desendettement force (delta OI). Les dumps
Binance USD-M couvrent :
  * fundingRate mensuel : 2020-01 (BTC/ETH), 2021-01 (SOL) -> aujourd'hui
  * metrics quotidien (open interest au pas 5 min) : 2021-01 -> aujourd'hui

Ce sont des taux OBSERVES sur un autre venue, pas une moyenne. L'ecart
OKX/Binance est mesure sur la fenetre de recouvrement disponible et rapporte
dans le controle qualite (cf. data/quality.py).
"""
from __future__ import annotations

import datetime as dt
import io
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests
from requests.adapters import HTTPAdapter

# Perp OKX -> perp Binance USD-M equivalent
SYMBOL_MAP = {
    "BTC-USDT-SWAP": "BTCUSDT",
    "ETH-USDT-SWAP": "ETHUSDT",
    "SOL-USDT-SWAP": "SOLUSDT",
    "XRP-USDT-SWAP": "XRPUSDT",
    "DOGE-USDT-SWAP": "DOGEUSDT",
    "ADA-USDT-SWAP": "ADAUSDT",
    "LTC-USDT-SWAP": "LTCUSDT",
    "LINK-USDT-SWAP": "LINKUSDT",
    "AVAX-USDT-SWAP": "AVAXUSDT",
    "DOT-USDT-SWAP": "DOTUSDT",
}


class BinanceVision:
    def __init__(self, base: str, threads: int = 12, timeout: int = 60):
        self.base = base.rstrip("/")
        self.threads = threads
        self.timeout = timeout
        self._local = threading.local()

    def _session(self) -> requests.Session:
        s = getattr(self._local, "session", None)
        if s is None:
            s = requests.Session()
            s.mount("https://", HTTPAdapter(pool_connections=4, pool_maxsize=8, max_retries=2))
            s.headers.update({"User-Agent": "okx-algo-research/1.0"})
            self._local.session = s
        return s

    def _fetch_csv(self, url: str) -> pd.DataFrame | None:
        """Retourne None si le fichier n'existe pas (404 = periode non couverte)."""
        for attempt in range(4):
            try:
                r = self._session().get(url, timeout=self.timeout)
                if r.status_code == 404:
                    return None
                r.raise_for_status()
                with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                    name = z.namelist()[0]
                    with z.open(name) as fh:
                        return pd.read_csv(fh)
            except (requests.RequestException, zipfile.BadZipFile):
                if attempt == 3:
                    return None
                import time
                time.sleep(0.5 * (2 ** attempt))
        return None

    # ------------------------------------------------------------------
    def funding(self, okx_symbol: str, start: dt.datetime, end: dt.datetime) -> pd.DataFrame:
        sym = SYMBOL_MAP.get(okx_symbol)
        if sym is None:
            return pd.DataFrame(columns=["datetime", "funding_rate"])
        months = _month_range(start, end)
        urls = [f"{self.base}/data/futures/um/monthly/fundingRate/{sym}/"
                f"{sym}-fundingRate-{m}.zip" for m in months]
        frames = self._parallel(urls)
        if not frames:
            return pd.DataFrame(columns=["datetime", "funding_rate"])
        df = pd.concat(frames, ignore_index=True)
        df = df.rename(columns={"calc_time": "ts", "last_funding_rate": "funding_rate",
                                "funding_interval_hours": "interval_hours"})
        df["ts"] = pd.to_numeric(df["ts"], errors="coerce")
        df["funding_rate"] = pd.to_numeric(df["funding_rate"], errors="coerce")
        df = df.dropna(subset=["ts", "funding_rate"])
        # les timestamps de settlement portent quelques ms de derive : on aligne
        # sur la grille 8h exacte, qui est la borne utilisee par le backtest
        df["ts"] = (df["ts"] / 1000).round().astype("int64") * 1000
        df["datetime"] = pd.to_datetime(df["ts"], unit="ms", utc=True).dt.round("min")
        df = df.drop_duplicates(subset="datetime").sort_values("datetime")
        df = df[(df["datetime"] >= _utc(start)) & (df["datetime"] <= _utc(end))]
        cols = ["datetime", "funding_rate"] + (["interval_hours"] if "interval_hours" in df else [])
        return df[cols].reset_index(drop=True)

    # ------------------------------------------------------------------
    def open_interest(self, okx_symbol: str, start: dt.datetime, end: dt.datetime) -> pd.DataFrame:
        """Open interest au pas 5 min (fichiers quotidiens `metrics`)."""
        sym = SYMBOL_MAP.get(okx_symbol)
        if sym is None:
            return pd.DataFrame(columns=["datetime", "open_interest", "open_interest_usd"])
        days = _day_range(start, end)
        urls = [f"{self.base}/data/futures/um/daily/metrics/{sym}/"
                f"{sym}-metrics-{d}.zip" for d in days]
        frames = self._parallel(urls)
        if not frames:
            return pd.DataFrame(columns=["datetime", "open_interest", "open_interest_usd"])
        df = pd.concat(frames, ignore_index=True)
        df = df.rename(columns={"create_time": "datetime",
                                "sum_open_interest": "open_interest",
                                "sum_open_interest_value": "open_interest_usd",
                                "count_long_short_ratio": "long_short_ratio",
                                "sum_taker_long_short_vol_ratio": "taker_ls_ratio"})
        df["datetime"] = pd.to_datetime(df["datetime"], utc=True, errors="coerce")
        keep = [c for c in ["datetime", "open_interest", "open_interest_usd",
                            "long_short_ratio", "taker_ls_ratio"] if c in df.columns]
        df = df[keep].dropna(subset=["datetime"])
        for c in keep[1:]:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        df = df.drop_duplicates(subset="datetime").sort_values("datetime")
        return df.reset_index(drop=True)

    # ------------------------------------------------------------------
    def _parallel(self, urls: list[str]) -> list[pd.DataFrame]:
        out: list[pd.DataFrame] = []
        with ThreadPoolExecutor(self.threads) as ex:
            futs = [ex.submit(self._fetch_csv, u) for u in urls]
            for f in as_completed(futs):
                d = f.result()
                if d is not None and len(d):
                    out.append(d)
        return out


def _utc(d: dt.datetime) -> pd.Timestamp:
    return pd.Timestamp(d).tz_localize("UTC") if pd.Timestamp(d).tz is None else pd.Timestamp(d)


def _month_range(start: dt.datetime, end: dt.datetime) -> list[str]:
    out, cur = [], dt.date(start.year, start.month, 1)
    last = dt.date(end.year, end.month, 1)
    while cur <= last:
        out.append(cur.strftime("%Y-%m"))
        cur = dt.date(cur.year + (cur.month == 12), (cur.month % 12) + 1, 1)
    return out


def _day_range(start: dt.datetime, end: dt.datetime) -> list[str]:
    out, cur = [], start.date()
    while cur <= end.date():
        out.append(cur.strftime("%Y-%m-%d"))
        cur += dt.timedelta(days=1)
    return out
