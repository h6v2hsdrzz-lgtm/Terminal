"""Fetch d'instruments supplémentaires (échelle de prix propre à chacun).

Usage : python3 scripts/fetch_extra.py SYMBOL SCALE
Réutilise le téléchargeur Dukascopy (bid+ask -> spread réel) avec une échelle
par symbole (forex 100000, indices/commodités 1000, BTC 10…).
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from goldsilver.config import FetchConfig  # noqa: E402
from goldsilver.data.fetch_dukascopy import fetch_symbol  # noqa: E402


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                        datefmt="%H:%M:%S", stream=sys.stdout)
    symbol, scale = sys.argv[1], float(sys.argv[2])
    cfg = FetchConfig(source="dukascopy", symbols=(symbol,), start="2019-01-01",
                      end=None, out_dir="data/raw", price_scale=scale,
                      pause_seconds=0.1)
    out = fetch_symbol(symbol, cfg, Path.cwd() / "data" / "raw")
    print("écrit:", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
