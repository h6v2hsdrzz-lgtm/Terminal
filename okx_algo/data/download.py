"""Orchestration du telechargement, par lots checkpointes (§17.5).

Chaque lot = (dataset, symbole, timeframe, tranche temporelle). Un lot termine
est marque dans run_state.json et n'est jamais rejoue ; un lot interrompu se
rejoue seul au prochain lancement. Le telechargement est donc idempotent et
reprend exactement ou il s'est arrete.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass

import pandas as pd

from ..core.config import Config
from ..core.persist import RunState
from .binance_vision import SYMBOL_MAP, BinanceVision
from .okx_client import OKXClient
from .store import ParquetStore

log = logging.getLogger("okx_algo.data")

# Tranches : 1m est decoupe finement pour limiter la perte en cas de coupure.
CHUNK_MONTHS = {"1m": 3, "15m": 12, "1H": 24, "4H": 36, "1D": 120}
INDEX_ID = {"BTC-USDT-SWAP": "BTC-USDT", "ETH-USDT-SWAP": "ETH-USDT",
            "SOL-USDT-SWAP": "SOL-USDT"}


@dataclass
class Chunk:
    label: str
    start: dt.datetime
    end: dt.datetime


def _chunks(start: dt.datetime, end: dt.datetime, months: int) -> list[Chunk]:
    out, cur = [], start
    while cur < end:
        y, m = cur.year, cur.month + months
        y += (m - 1) // 12
        m = (m - 1) % 12 + 1
        nxt = min(dt.datetime(y, m, 1, tzinfo=dt.timezone.utc), end)
        out.append(Chunk(f"{cur:%Y%m}-{nxt:%Y%m}", cur, nxt))
        cur = nxt
    return out


class Downloader:
    def __init__(self, cfg: Config, state: RunState):
        self.cfg = cfg
        self.state = state
        self.store = ParquetStore(cfg.data_root)
        self.okx = OKXClient(
            cfg.get("data.okx_base"),
            rate_per_s=cfg.get("data.max_requests_per_second"),
            threads=cfg.get("data.download_threads"),
            timeout=cfg.get("data.request_timeout_s"),
            retries=cfg.get("data.request_retries"),
        )
        self.bv = BinanceVision(cfg.get("data.binance_vision_base"))
        self.start = cfg.data_start()
        self.end = cfg.data_end()
        self._listing_cache: dict[str, dt.datetime] | None = None

    # ------------------------------------------------------------------
    def symbol_start(self, symbol: str) -> dt.datetime:
        """Ne pas interroger avant la cotation de l'instrument (requetes vides)."""
        listed = self._listing.get(symbol)
        return max(self.start, listed) if listed else self.start

    @property
    def _listing(self) -> dict[str, dt.datetime]:
        if self._listing_cache is None:
            self._listing_cache = {}
            try:
                inst = self.instruments()
                for _, row in inst.iterrows():
                    ts = pd.to_numeric(row.get("listTime"), errors="coerce")
                    if pd.notna(ts):
                        self._listing_cache[row["instId"]] = dt.datetime.fromtimestamp(
                            int(ts) / 1000, tz=dt.timezone.utc)
            except Exception as exc:  # pas bloquant : on retombe sur la borne globale
                log.warning("dates de cotation indisponibles: %s", exc)
        return self._listing_cache

    # ------------------------------------------------------------------
    def _run_chunked(self, dataset: str, symbol: str, timeframe: str,
                     fetch, months: int) -> None:
        for ch in _chunks(self.symbol_start(symbol), self.end, months):
            step = f"dl:{dataset}:{symbol}:{timeframe}:{ch.label}"
            if self.state.is_done(step):
                continue
            df = fetch(ch.start, ch.end)
            if df is not None and len(df):
                self.store.upsert(df, dataset, symbol, timeframe)
            self.state.mark_done(step, rows=int(len(df)) if df is not None else 0)
            log.info("%s -> %d lignes", step, 0 if df is None else len(df))

    # ------------------------------------------------------------------
    def ohlcv(self, symbols: list[str], timeframes: list[str]) -> None:
        for tf in timeframes:
            for sym in symbols:
                self._run_chunked(
                    "ohlcv", sym, tf,
                    lambda s, e, sym=sym, tf=tf: self.okx.ohlcv(sym, tf, s, e),
                    CHUNK_MONTHS.get(tf, 12),
                )

    def mark_index(self, symbols: list[str], timeframe: str = "1H") -> None:
        for sym in symbols:
            self._run_chunked(
                "mark", sym, timeframe,
                lambda s, e, sym=sym, tf=timeframe: self.okx.mark_price(sym, tf, s, e),
                CHUNK_MONTHS.get(timeframe, 12),
            )
            idx = INDEX_ID.get(sym)
            if idx:
                self._run_chunked(
                    "index", sym, timeframe,
                    lambda s, e, idx=idx, tf=timeframe: self.okx.index_price(idx, tf, s, e),
                    CHUNK_MONTHS.get(timeframe, 12),
                )

    # ------------------------------------------------------------------
    def funding(self, symbols: list[str]) -> None:
        """Deux series distinctes, jamais melangees :
        `funding` = historique profond Binance USD-M (source de travail),
        `funding_okx` = funding OKX reel sur ~3 mois (reference de validation).
        """
        for sym in symbols:
            step = f"dl:funding:{sym}"
            if not self.state.is_done(step):
                df = self.bv.funding(sym, self.symbol_start(sym), self.end)
                if len(df):
                    self.store.upsert(df, "funding", sym)
                self.state.mark_done(step, rows=int(len(df)), source="binance_vision")
                log.info("%s -> %d lignes", step, len(df))

            step_okx = f"dl:funding_okx:{sym}"
            if not self.state.is_done(step_okx):
                ref = self.okx.funding_history(sym, self.end - dt.timedelta(days=400), self.end)
                if len(ref):
                    self.store.upsert(ref[["datetime", "funding_rate"]], "funding_okx", sym)
                self.state.mark_done(step_okx, rows=int(len(ref)), source="okx")
                log.info("%s -> %d lignes", step_okx, len(ref))

    def open_interest(self, symbols: list[str]) -> None:
        for sym in symbols:
            if sym not in SYMBOL_MAP:
                continue
            for ch in _chunks(self.symbol_start(sym), self.end, 6):
                step = f"dl:oi:{sym}:{ch.label}"
                if self.state.is_done(step):
                    continue
                df = self.bv.open_interest(sym, ch.start, ch.end)
                if len(df):
                    self.store.upsert(df, "open_interest", sym)
                self.state.mark_done(step, rows=int(len(df)))
                log.info("%s -> %d lignes", step, len(df))

    # ------------------------------------------------------------------
    def instruments(self) -> pd.DataFrame:
        step = "dl:instruments"
        if not self.state.is_done(step):
            df = self.okx.instruments("SWAP")
            self.store.write(df.astype(str), "meta", "instruments_swap")
            self.state.mark_done(step, rows=int(len(df)))
        return self.store.read("meta", "instruments_swap")

    # ------------------------------------------------------------------
    def run_fast(self, symbols: list[str]) -> None:
        """Tout sauf le 1m : quelques dizaines de minutes."""
        self.instruments()
        self.funding(symbols)
        self.open_interest(symbols)
        self.mark_index(symbols, "1H")
        self.ohlcv(symbols, [tf for tf in self.cfg.get("data.timeframes") if tf != "1m"])

    def run_minute(self, symbols: list[str]) -> None:
        """Le 1m seul : plusieurs heures, a lancer en tache de fond."""
        self.ohlcv(symbols, ["1m"])
