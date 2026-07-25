"""Téléchargement incrémental des données de marché (OHLCV, funding, mark, index, OI).

Reprise automatique : chaque appel repart de la dernière barre stockée.
Les barres non clôturées ne sont jamais écrites (source classique de lookahead).
"""

from __future__ import annotations

import time
from typing import Any, Callable

import pandas as pd

from ..config import Config, load_config, resolve_path
from ..utils import get_logger, now_utc, timeframe_to_ms, to_ms, to_utc
from .exchange import call_with_retry, resolve_exchange
from .store import OHLCV_COLUMNS, ParquetStore

log = get_logger("data.download")


class Downloader:
    def __init__(self, cfg: Config, exchange=None):
        self.cfg = cfg
        self.store = ParquetStore(resolve_path(cfg, cfg.get_path("data.store_path")))
        self.max_retries = int(cfg.get_path("data.max_retries"))
        self.backoff = list(cfg.get_path("data.retry_backoff_seconds"))
        self.pause = float(cfg.get_path("data.request_pause_seconds"))
        self._ex = exchange

    # ------------------------------------------------------------------ utils
    @property
    def ex(self):
        if self._ex is None:
            self._ex = resolve_exchange(
                self.cfg.get_path("data.exchange"),
                self.cfg.get_path("data.fallback_exchanges"),
            )
        return self._ex

    def _retry(self, fn: Callable, *args, **kwargs):
        return call_with_retry(
            fn, *args, max_retries=self.max_retries, backoff=self.backoff, **kwargs
        )

    def _resume_from(self, kind: str, symbol: str, timeframe: str | None, step_ms: int) -> int:
        """Point de reprise : dernière barre stockée moins 2 pas (refresh de bord)."""
        last = self.store.last_timestamp(kind, symbol, timeframe)
        if last is None:
            return to_ms(self.cfg.get_path("data.start"))
        return int(last) - 2 * step_ms

    # ------------------------------------------------------------------ OHLCV
    def download_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        kind: str = "ohlcv",
        start=None,
        end=None,
        batch_limit: int = 300,
    ) -> int:
        """Télécharge/complète une série OHLCV. Renvoie le nombre de barres ajoutées."""
        step = timeframe_to_ms(timeframe)
        fetcher = {
            "ohlcv": self.ex.fetch_ohlcv,
            "mark": getattr(self.ex, "fetch_mark_ohlcv", None),
            "index": getattr(self.ex, "fetch_index_ohlcv", None),
        }[kind]
        if fetcher is None:
            log.warning("%s: %s non supporté par l'exchange", symbol, kind)
            return 0

        end_ms = to_ms(end) if end is not None else to_ms(self.cfg.get_path("data.end"))
        if end_ms is None:
            end_ms = int(now_utc().value // 1_000_000)
        # une barre n'est exploitable qu'une fois close
        closed_before = int(now_utc().value // 1_000_000) - step
        end_ms = min(end_ms, closed_before)

        desired_start = to_ms(start) if start is not None else to_ms(self.cfg.get_path("data.start"))
        added = 0

        # 1) comblement amont : une série déjà présente mais commençant trop tard
        #    ne doit pas empêcher la récupération de son passé.
        first = self.store.first_timestamp(kind, symbol, timeframe)
        if first is not None and first > desired_start + step:
            added += self._fetch_range(
                fetcher, symbol, timeframe, kind, desired_start, first, step, batch_limit
            )

        # 2) prolongement aval depuis la dernière barre stockée
        forward_start = to_ms(start) if start is not None else self._resume_from(kind, symbol, timeframe, step)
        added += self._fetch_range(
            fetcher, symbol, timeframe, kind, forward_start, end_ms, step, batch_limit
        )
        log.info("%s %s %s : +%s barres", symbol, timeframe, kind, f"{added:,}")
        return added

    def _fetch_range(
        self, fetcher, symbol: str, timeframe: str, kind: str,
        start_ms: int, end_ms: int, step: int, batch_limit: int,
    ) -> int:
        added, batches, cursor = 0, 0, int(start_ms)
        while cursor < end_ms:
            raw = self._retry(fetcher, symbol, timeframe, since=cursor, limit=batch_limit)
            if not raw:
                # trou éventuel : on saute une fenêtre complète et on réessaie
                cursor += step * batch_limit
                if cursor >= end_ms:
                    break
                continue
            df = pd.DataFrame(raw, columns=OHLCV_COLUMNS)
            df = df[(df["timestamp"] >= cursor) & (df["timestamp"] < end_ms)]
            if df.empty:
                cursor += step * batch_limit
                continue
            self.store.merge(df, kind, symbol, timeframe)
            added += len(df)
            batches += 1
            new_cursor = int(df["timestamp"].max()) + step
            if new_cursor <= cursor:  # pas de progression -> on force
                new_cursor = cursor + step * batch_limit
            cursor = new_cursor
            if batches % 25 == 0:
                log.info(
                    "%s %s %s : %s barres (curseur %s)",
                    symbol, timeframe, kind, f"{added:,}",
                    pd.to_datetime(cursor, unit="ms", utc=True).strftime("%Y-%m-%d"),
                )
            time.sleep(self.pause)
        return added

    # ---------------------------------------------------------------- funding
    def download_funding(self, symbol: str, start=None, end=None, batch_limit: int = 100,
                         max_pages: int | None = None) -> int:
        """Historique réel des taux de funding (cycles 8h), pagination **descendante**.

        OKX inverse la convention habituelle sur cet endpoint : ``after`` renvoie
        les enregistrements *antérieurs* au timestamp fourni. On remonte donc le
        temps depuis le présent jusqu'à ``data.start`` (ou jusqu'à épuisement de
        la rétention de l'exchange — ~3 mois chez OKX, cf. rapport qualité).
        """
        start_ms = to_ms(start) if start is not None else to_ms(self.cfg.get_path("data.start"))
        end_ms = to_ms(end) or int(now_utc().value // 1_000_000)
        added, cursor, pages = 0, end_ms, 0
        page_cap = max_pages if max_pages is not None else 5000
        while pages < page_cap:
            params = {"after": str(int(cursor))} if cursor else {}
            raw = self._retry(
                self.ex.fetch_funding_rate_history, symbol, since=None, limit=batch_limit, params=params
            )
            if not raw:
                break
            rows = [
                {"timestamp": int(r["timestamp"]), "funding_rate": float(r["fundingRate"])}
                for r in raw
                if r.get("timestamp") is not None and r.get("fundingRate") is not None
            ]
            if not rows:
                break
            df = pd.DataFrame(rows)
            df = df[(df["timestamp"] >= start_ms) & (df["timestamp"] < end_ms)]
            if not df.empty:
                self.store.merge(df, "funding", symbol)
                added += len(df)
            oldest = min(int(r["timestamp"]) for r in rows)
            if oldest <= start_ms:
                break
            cursor = oldest
            pages += 1
            time.sleep(self.pause)
        log.info("%s funding réel : +%s points (%d pages)", symbol, f"{added:,}", pages)
        return added

    # --------------------------------------------------------- open interest
    def download_open_interest(self, symbol: str, timeframe: str = "1h") -> int:
        """Best-effort : l'historique d'OI est court chez la plupart des exchanges."""
        fn = getattr(self.ex, "fetch_open_interest_history", None)
        if fn is None:
            log.warning("open interest non supporté")
            return 0
        try:
            raw = self._retry(fn, symbol, timeframe, limit=1000)
        except Exception as exc:  # noqa: BLE001
            log.warning("open interest indisponible pour %s : %s", symbol, str(exc)[:120])
            return 0
        rows = [
            {
                "timestamp": int(r["timestamp"]),
                "open_interest": float(r.get("openInterestAmount") or r.get("openInterestValue") or 0.0),
            }
            for r in raw
            if r.get("timestamp")
        ]
        if not rows:
            return 0
        self.store.merge(pd.DataFrame(rows), "open_interest", symbol)
        log.info("%s open interest : +%s points", symbol, f"{len(rows):,}")
        return len(rows)

    # -------------------------------------------------------------- orchestre
    def download_all(
        self,
        symbols: list[str] | None = None,
        timeframes: list[str] | None = None,
        include_intrabar: bool = True,
        include_annex: bool = True,
    ) -> dict[str, Any]:
        symbols = symbols or list(self.cfg.get_path("universe.symbols"))
        tfs = list(timeframes or self.cfg.get_path("data.signal_timeframes"))
        exec_tf = self.cfg.get_path("data.execution_timeframe")
        if exec_tf not in tfs:
            tfs.append(exec_tf)
        if include_intrabar:
            intrabar = self.cfg.get_path("data.intrabar_timeframe")
            if intrabar not in tfs:
                tfs.append(intrabar)

        report: dict[str, Any] = {}
        for symbol in symbols:
            for tf in tfs:
                report[f"{symbol}|ohlcv|{tf}"] = self.download_ohlcv(symbol, tf)
            if include_annex:
                if self.cfg.get_path("data.fetch_funding"):
                    report[f"{symbol}|funding"] = self.download_funding(symbol)
                if self.cfg.get_path("data.fetch_mark"):
                    report[f"{symbol}|mark"] = self.download_ohlcv(symbol, exec_tf, kind="mark")
                if self.cfg.get_path("data.fetch_index"):
                    report[f"{symbol}|index"] = self.download_ohlcv(symbol, exec_tf, kind="index")
                if self.cfg.get_path("data.fetch_open_interest"):
                    report[f"{symbol}|oi"] = self.download_open_interest(symbol)
        return report


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Téléchargement incrémental des données")
    parser.add_argument("--config", nargs="*", default=None)
    parser.add_argument("--symbols", nargs="*", default=None)
    parser.add_argument("--timeframes", nargs="*", default=None)
    parser.add_argument("--start", default=None)
    parser.add_argument("--no-intrabar", action="store_true")
    parser.add_argument("--no-annex", action="store_true")
    parser.add_argument("--only", choices=["ohlcv", "funding", "mark", "index", "oi"], default=None)
    args = parser.parse_args(argv)

    from ..utils import setup_logging

    setup_logging("INFO")
    cfg = load_config(args.config)
    if args.start:
        cfg = cfg.with_overrides({"data.start": args.start})
    dl = Downloader(cfg)
    symbols = args.symbols or list(cfg.get_path("universe.symbols"))

    if args.only == "funding":
        for s in symbols:
            dl.download_funding(s)
    elif args.only in ("mark", "index"):
        tf = cfg.get_path("data.execution_timeframe")
        for s in symbols:
            dl.download_ohlcv(s, tf, kind=args.only)
    elif args.only == "oi":
        for s in symbols:
            dl.download_open_interest(s)
    elif args.only == "ohlcv":
        tfs = args.timeframes or list(cfg.get_path("data.signal_timeframes"))
        for s in symbols:
            for tf in tfs:
                dl.download_ohlcv(s, tf)
    else:
        dl.download_all(
            symbols=symbols,
            timeframes=args.timeframes,
            include_intrabar=not args.no_intrabar,
            include_annex=not args.no_annex,
        )

    inv = dl.store.inventory()
    if not inv.empty:
        log.info("Inventaire du cache :\n%s", inv.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
