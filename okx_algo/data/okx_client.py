"""Client OKX REST : historique profond, rate-limite, parallelise, resilient.

Strategie de pagination : les bougies OKX sont sur une grille temporelle fixe.
Plutot que de suivre un curseur sequentiel (lent), on calcule a l'avance tous
les timestamps `after` de la grille et on tire les requetes en parallele sous
un token bucket global. Un trou de marche produit un chevauchement (dedupe
ensuite), jamais un trou de couverture : `after` est un filtre temporel absolu,
pas un curseur.
"""
from __future__ import annotations

import datetime as dt
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Iterable

import pandas as pd
import requests
from requests.adapters import HTTPAdapter

BAR_MS = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1H": 3_600_000,
    "2H": 7_200_000,
    "4H": 14_400_000,
    "6H": 21_600_000,
    "12H": 43_200_000,
    "1D": 86_400_000,
}

CANDLE_COLS = ["ts", "open", "high", "low", "close", "volume", "volume_ccy",
               "volume_quote", "confirm"]
MARK_COLS = ["ts", "open", "high", "low", "close", "confirm"]


class RateLimiter:
    """Token bucket global partage par tous les threads."""

    def __init__(self, rate_per_s: float, burst: float | None = None):
        self.rate = float(rate_per_s)
        self.capacity = float(burst if burst is not None else max(1.0, rate_per_s))
        self._tokens = self.capacity
        self._last = time.monotonic()
        self._lock = threading.Lock()

    def acquire(self, n: float = 1.0) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rate)
                self._last = now
                if self._tokens >= n:
                    self._tokens -= n
                    return
                wait = (n - self._tokens) / self.rate
            time.sleep(min(wait, 0.25))


class OKXClient:
    def __init__(self, base: str, rate_per_s: float = 8.0, threads: int = 10,
                 timeout: int = 30, retries: int = 5):
        self.base = base.rstrip("/")
        self.limiter = RateLimiter(rate_per_s)
        self.threads = threads
        self.timeout = timeout
        self.retries = retries
        self._local = threading.local()

    # ------------------------------------------------------------------
    def _session(self) -> requests.Session:
        s = getattr(self._local, "session", None)
        if s is None:
            s = requests.Session()
            adapter = HTTPAdapter(pool_connections=4, pool_maxsize=8, max_retries=0)
            s.mount("https://", adapter)
            s.headers.update({"User-Agent": "okx-algo-research/1.0"})
            self._local.session = s
        return s

    def get(self, path: str, **params: Any) -> list:
        """GET rate-limite avec backoff exponentiel. Retourne data[] ou leve."""
        last_err: Exception | None = None
        for attempt in range(self.retries):
            self.limiter.acquire()
            try:
                r = self._session().get(self.base + path, params=params, timeout=self.timeout)
                if r.status_code == 429:
                    time.sleep(1.0 * (2 ** attempt))
                    continue
                r.raise_for_status()
                payload = r.json()
                code = payload.get("code")
                if code == "0":
                    return payload.get("data", [])
                if code in {"50011", "50013", "50026"}:  # rate limit / systeme occupe
                    time.sleep(0.8 * (2 ** attempt))
                    last_err = RuntimeError(f"okx code {code}: {payload.get('msg')}")
                    continue
                raise RuntimeError(f"okx code {code}: {payload.get('msg')} ({path} {params})")
            except (requests.RequestException, ValueError) as exc:
                last_err = exc
                time.sleep(0.5 * (2 ** attempt))
        raise RuntimeError(f"echec apres {self.retries} tentatives sur {path} {params}: {last_err}")

    # ------------------------------------------------------------------
    def instruments(self, inst_type: str = "SWAP") -> pd.DataFrame:
        return pd.DataFrame(self.get("/api/v5/public/instruments", instType=inst_type))

    # ------------------------------------------------------------------
    def _grid_fetch(self, path: str, inst_id: str, bar: str, start_ms: int, end_ms: int,
                    columns: list[str], progress: Callable[[int, int], None] | None = None,
                    limit: int = 100) -> pd.DataFrame:
        step = BAR_MS[bar] * limit
        afters = list(range(end_ms + step, start_ms, -step))
        rows: list[list] = []
        done = 0

        def one(after: int) -> list:
            return self.get(path, instId=inst_id, bar=bar, limit=str(limit), after=str(after))

        with ThreadPoolExecutor(self.threads) as ex:
            futs = {ex.submit(one, a): a for a in afters}
            for fut in as_completed(futs):
                rows.extend(fut.result())
                done += 1
                if progress and done % 200 == 0:
                    progress(done, len(afters))
        if not rows:
            return pd.DataFrame(columns=columns)

        df = pd.DataFrame(rows, columns=columns[: len(rows[0])])
        df["ts"] = pd.to_numeric(df["ts"], errors="coerce").astype("Int64")
        df = df.dropna(subset=["ts"])
        df = df[(df["ts"] >= start_ms) & (df["ts"] <= end_ms)]
        for c in df.columns:
            if c != "ts":
                df[c] = pd.to_numeric(df[c], errors="coerce")
        df = df.drop_duplicates(subset="ts").sort_values("ts").reset_index(drop=True)
        df.insert(0, "datetime", pd.to_datetime(df["ts"], unit="ms", utc=True))
        return df

    # ------------------------------------------------------------------
    def ohlcv(self, inst_id: str, bar: str, start: dt.datetime, end: dt.datetime,
              progress: Callable[[int, int], None] | None = None) -> pd.DataFrame:
        return self._grid_fetch("/api/v5/market/history-candles", inst_id, bar,
                                _ms(start), _ms(end), CANDLE_COLS, progress)

    def mark_price(self, inst_id: str, bar: str, start: dt.datetime, end: dt.datetime,
                   progress: Callable[[int, int], None] | None = None) -> pd.DataFrame:
        return self._grid_fetch("/api/v5/market/history-mark-price-candles", inst_id, bar,
                                _ms(start), _ms(end), MARK_COLS, progress)

    def index_price(self, index_id: str, bar: str, start: dt.datetime, end: dt.datetime,
                    progress: Callable[[int, int], None] | None = None) -> pd.DataFrame:
        return self._grid_fetch("/api/v5/market/history-index-candles", index_id, bar,
                                _ms(start), _ms(end), MARK_COLS, progress)

    # ------------------------------------------------------------------
    def funding_history(self, inst_id: str, start: dt.datetime, end: dt.datetime) -> pd.DataFrame:
        """Funding OKX reel. ATTENTION : l'API publique ne retient qu'environ
        3 mois. Sert de reference de validation croisee, pas d'historique."""
        rows: list[dict] = []
        after = _ms(end)
        floor = _ms(start)
        while True:
            data = self.get("/api/v5/public/funding-rate-history", instId=inst_id,
                            limit="100", after=str(after))
            if not data:
                break
            rows.extend(data)
            after = int(data[-1]["fundingTime"])
            if after <= floor:
                break
        if not rows:
            return pd.DataFrame(columns=["datetime", "funding_rate"])
        df = pd.DataFrame(rows)
        df["ts"] = pd.to_numeric(df["fundingTime"])
        df["funding_rate"] = pd.to_numeric(df.get("realizedRate", df["fundingRate"]))
        df = df.drop_duplicates(subset="ts").sort_values("ts")
        df = df[df["ts"] >= floor]
        df.insert(0, "datetime", pd.to_datetime(df["ts"], unit="ms", utc=True))
        return df[["datetime", "ts", "funding_rate"]].reset_index(drop=True)

    def open_interest_history(self, inst_id: str, period: str,
                              start: dt.datetime, end: dt.datetime) -> pd.DataFrame:
        """OI OKX. Profondeur limitee (1D ~2024+, 1H ~2 mois)."""
        rows: list[list] = []
        end_ms = _ms(end)
        floor = _ms(start)
        while True:
            data = self.get("/api/v5/rubik/stat/contracts/open-interest-history",
                            instId=inst_id, period=period, limit="100", end=str(end_ms))
            if not data:
                break
            rows.extend(data)
            end_ms = int(data[-1][0]) - 1
            if end_ms <= floor:
                break
        if not rows:
            return pd.DataFrame(columns=["datetime", "open_interest"])
        df = pd.DataFrame(rows).iloc[:, :4]
        df.columns = ["ts", "oi_ccy", "oi_contracts", "oi_usd"][: df.shape[1]]
        df["ts"] = pd.to_numeric(df["ts"])
        for c in df.columns[1:]:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        df = df.drop_duplicates(subset="ts").sort_values("ts")
        df = df[df["ts"] >= floor]
        df.insert(0, "datetime", pd.to_datetime(df["ts"], unit="ms", utc=True))
        return df.reset_index(drop=True)


def _ms(d: dt.datetime) -> int:
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return int(d.timestamp() * 1000)
