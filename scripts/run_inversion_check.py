#!/usr/bin/env python3
"""Contrôle d'inversion : la perte vient-elle d'une erreur de signe ?

Rejoue la stratégie avec l'opinion de **toutes** les familles retournée, en
conservant régimes, routage, risque et coûts. Trois lectures possibles :

* la version inversée gagne nettement -> il y a une erreur de signe quelque part
  (ou un edge contrarien réel, à isoler proprement) ;
* les deux versions perdent -> les signaux n'ont pas de contenu directionnel et
  les coûts font le reste ;
* les deux versions perdent **du même montant que les coûts** -> le PnL brut est
  nul en espérance : c'est du bruit.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from crypto_algo.config import load_config, resolve_path  # noqa: E402
from crypto_algo.data.loader import load_market_data, split_bounds  # noqa: E402
from crypto_algo.utils import ensure_dir, get_logger, setup_logging  # noqa: E402
from crypto_algo.validation.runner import ValidationRunner  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", nargs="*", default=None)
    args = ap.parse_args()

    setup_logging("INFO")
    log = get_logger("scripts.inversion")
    cfg = load_config(args.config)
    md = load_market_data(cfg, split="in_sample", include_intrabar=True)
    start, end = split_bounds(cfg, "in_sample")

    runner = ValidationRunner(cfg, md, registry=None)
    rows = []
    for label, params in (("normal", {}), ("inversé", {"invert_signals": True})):
        outcome = runner.run_once(params, start, end, label=f"inversion_{label}", record=False)
        m = outcome.metrics
        rows.append(
            {
                "version": label,
                "trades": m.get("trades"),
                "gross_pnl": m.get("gross_pnl"),
                "costs_total": m.get("costs_total"),
                "net_pnl": m.get("net_pnl"),
                "total_return": m.get("total_return"),
                "sharpe": m.get("sharpe"),
                "max_drawdown": m.get("max_drawdown"),
                "win_rate": m.get("win_rate"),
                "expectancy_r": m.get("expectancy_r"),
                "killed": m.get("killed"),
            }
        )
    table = pd.DataFrame(rows)
    out = ensure_dir(resolve_path(cfg, cfg.get_path("reports.output_dir")) / "tables")
    table.to_csv(out / "inversion_check.csv", index=False)
    log.info("Contrôle d'inversion :\n%s", table.to_string(index=False))
    print(table.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
