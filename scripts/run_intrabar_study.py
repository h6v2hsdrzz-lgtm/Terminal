#!/usr/bin/env python3
"""Mesure du biais de résolution intrabar sur une sous-période (§7).

Le backtest résout les bougies ambiguës (stop **et** objectif touchés dans la
même barre) en 5m sur tout l'historique, faute d'un historique 1m téléchargeable
en un temps raisonnable. Ce script mesure l'écart réel entre 1m, 5m et
l'hypothèse pessimiste sur une fenêtre où le 1m est disponible, au lieu de le
supposer négligeable.

    python scripts/fetch_history.py --symbol "BTC/USDT:USDT" --only 1m --start 2023-10-01T00:00:00Z
    python scripts/run_intrabar_study.py --start 2023-10-01 --end 2024-01-01
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from crypto_algo.config import load_config, resolve_path  # noqa: E402
from crypto_algo.data.loader import load_market_data  # noqa: E402
from crypto_algo.data.store import ParquetStore  # noqa: E402
from crypto_algo.strategies.composite import RoutedMultiFamilyStrategy  # noqa: E402
from crypto_algo.utils import ensure_dir, get_logger, setup_logging  # noqa: E402
from crypto_algo.validation.intrabar_bias import measure_intrabar_bias  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", nargs="*", default=None)
    ap.add_argument("--start", default="2023-10-01T00:00:00Z")
    ap.add_argument("--end", default="2024-01-01T00:00:00Z")
    args = ap.parse_args()

    setup_logging("INFO")
    log = get_logger("scripts.intrabar")
    cfg = load_config(args.config)
    store = ParquetStore(resolve_path(cfg, cfg.get_path("data.store_path")))

    # la fenêtre d'étude doit rester dans l'in-sample (le verrou OOS s'applique)
    md = load_market_data(cfg, split="in_sample", include_intrabar=True)
    md = md.slice(pd.Timestamp(args.start) - pd.Timedelta(days=120), args.end)

    table = measure_intrabar_bias(
        cfg, md, lambda: RoutedMultiFamilyStrategy(cfg), store,
        start=pd.Timestamp(args.start) - pd.Timedelta(days=120), end=args.end,
    )
    out = ensure_dir(resolve_path(cfg, cfg.get_path("reports.output_dir")) / "tables")
    table.to_csv(out / "intrabar_bias.csv", index=False)
    log.info("Biais de résolution intrabar :\n%s", table.to_string(index=False))
    print(table.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
