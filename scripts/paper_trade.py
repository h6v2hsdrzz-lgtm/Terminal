#!/usr/bin/env python3
"""Paper trading (phase 7) : 60 jours minimum avant tout capital réel.

    python scripts/paper_trade.py --iterations 1        # une passe (cron)
    python scripts/paper_trade.py                       # boucle continue
    python scripts/paper_trade.py --report              # comparaison live/backtest
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from crypto_algo.config import load_config, resolve_path  # noqa: E402
from crypto_algo.live.paper import PaperTrader, compare_live_vs_backtest  # noqa: E402
from crypto_algo.utils import get_logger, setup_logging  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", nargs="*", default=None)
    ap.add_argument("--iterations", type=int, default=None, help="nombre de passes (défaut : infini)")
    ap.add_argument("--poll", type=int, default=None, help="secondes entre deux passes")
    ap.add_argument("--report", action="store_true", help="comparer les métriques live et backtest")
    args = ap.parse_args()

    setup_logging("INFO", logfile="logs/paper.log")
    log = get_logger("scripts.paper")
    cfg = load_config(args.config)
    trader = PaperTrader(cfg)

    if args.report:
        trades = pd.DataFrame(trader.state.trades)
        if trades.empty:
            log.warning("aucun trade papier enregistré pour le moment")
            return 0
        equity = pd.Series(
            trades["equity_after"].astype(float).to_numpy(),
            index=pd.to_datetime(trades["closed_at"], utc=True),
        )
        summary_path = resolve_path(cfg, cfg.get_path("reports.output_dir")) / "summary.json"
        backtest_metrics = {}
        if summary_path.exists():
            backtest_metrics = json.loads(summary_path.read_text()).get("in_sample", {})
        table = compare_live_vs_backtest(trades, equity, backtest_metrics)
        print(table.to_string(index=False))
        days = (equity.index.max() - equity.index.min()).days if len(equity) > 1 else 0
        minimum = int(cfg.get_path("paper.min_days"))
        print(f"\nDurée observée : {days} jours (minimum requis : {minimum}).")
        if days < minimum:
            print("Échantillon insuffisant : aucune conclusion live n'est recevable.")
        return 0

    trader.run(max_iterations=args.iterations, poll_seconds=args.poll)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
