#!/usr/bin/env python3
"""Téléchargement complet de l'historique d'un symbole (script Phase 1).

Ordre de priorité : ce qui bloque le backtest d'abord (OHLCV du timeframe
d'exécution, mark price pour la liquidation), l'accessoire ensuite.

Usage :
    python scripts/fetch_history.py --symbol "BTC/USDT:USDT"
    python scripts/fetch_history.py --symbol "BTC/USDT:USDT" --only 1m --start 2024-01-01T00:00:00Z
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crypto_algo.config import load_config  # noqa: E402
from crypto_algo.data.download import Downloader  # noqa: E402
from crypto_algo.utils import get_logger, setup_logging  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--config", nargs="*", default=None)
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--only", default=None,
                    help="timeframe unique à traiter (ex. '1m') ou 'annex'")
    args = ap.parse_args()

    setup_logging("INFO")
    log = get_logger("scripts.fetch")
    cfg = load_config(args.config)
    if args.start:
        cfg = cfg.with_overrides({"data.start": args.start})
    dl = Downloader(cfg)
    sym = args.symbol
    exec_tf = cfg.get_path("data.execution_timeframe")
    intrabar_tf = cfg.get_path("data.intrabar_timeframe")

    if args.only == "annex":
        dl.download_funding(sym)
        dl.download_open_interest(sym)
        dl.download_ohlcv(sym, "1h", kind="index", start=args.start, end=args.end)
        return 0
    if args.only:
        dl.download_ohlcv(sym, args.only, start=args.start, end=args.end)
        log.info("terminé (%s) : %s", args.only, sym)
        return 0

    # 1) ce sans quoi le backtest ne tourne pas
    dl.download_ohlcv(sym, exec_tf, start=args.start, end=args.end)
    dl.download_ohlcv(sym, exec_tf, kind="mark", start=args.start, end=args.end)
    # 2) funding réel (rétention courte) + index pour la reconstruction
    dl.download_funding(sym)
    dl.download_ohlcv(sym, "1h", kind="index", start=args.start, end=args.end)
    # 3) timeframes de signaux
    for tf in ["4h", "1h", "5m"]:
        if tf != exec_tf:
            dl.download_ohlcv(sym, tf, start=args.start, end=args.end)
    # 4) résolution intrabar
    if intrabar_tf != exec_tf:
        dl.download_ohlcv(sym, intrabar_tf, start=args.start, end=args.end)
    # 5) accessoire
    dl.download_open_interest(sym)

    log.info("terminé : %s", sym)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
