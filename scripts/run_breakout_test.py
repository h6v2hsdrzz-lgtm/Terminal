#!/usr/bin/env python3
"""Test d'une hypothèse isolée : cassure de canal (Donchian) en 4h.

Protocole identique au reste de l'audit — **in-sample uniquement**, coûts
complets, moteur de risque inchangé, essais comptés dans le registre pour le
Deflated Sharpe Ratio.

Deux régimes de détention sont mesurés :

* ``5 jours`` — la contrainte du cahier des charges ;
* ``sans plafond`` — parce qu'un suivi de tendance vit de quelques trades tenus
  plusieurs semaines, et que couper à 5 jours retire précisément la queue de
  distribution qui le finance. C'est un diagnostic, pas une proposition de
  relâcher une contrainte de risque.

    python scripts/run_breakout_test.py
"""

from __future__ import annotations

import argparse
import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pandas as pd  # noqa: E402

from crypto_algo.backtest.engine import BacktestEngine  # noqa: E402
from crypto_algo.config import load_config, resolve_path  # noqa: E402
from crypto_algo.data.loader import load_market_data, split_bounds  # noqa: E402
from crypto_algo.reports.metrics import compute_metrics, summarize_by  # noqa: E402
from crypto_algo.strategies.breakout import DonchianBreakoutStrategy  # noqa: E402
from crypto_algo.utils import ensure_dir, get_logger, setup_logging  # noqa: E402
from crypto_algo.validation.benchmarks import build_benchmarks  # noqa: E402
from crypto_algo.validation.deflated_sharpe import TrialRegistry  # noqa: E402

log = get_logger("scripts.breakout")

GRID = {
    "entry_period": [10, 20, 55],      # ~1,7 / 3,3 / 9 jours en 4h
    "exit_period": [5, 10, 20],
    "atr_stop_mult": [2.0, 3.0],
    "trend_filter": [False, True],
}


def run(cfg, md, start, end, params, holding_days, registry, label):
    run_cfg = cfg.with_overrides({"risk.max_holding_days": holding_days})
    strategy = DonchianBreakoutStrategy(run_cfg, **params)
    result = BacktestEngine(run_cfg, md, strategy).run()
    equity = result.equity["equity"]
    trades = result.trades
    if start is not None:
        s = pd.Timestamp(start)
        equity = equity[equity.index >= s]
        if len(trades):
            trades = trades[pd.to_datetime(trades["opened_at"]) >= s].reset_index(drop=True)
    report = compute_metrics(
        equity, trades, stats=result.stats,
        days_per_year=int(cfg.get_path("reports.annualization_days")), name=label,
    )
    if registry is not None:
        registry.record(label, {**params, "max_holding_days": holding_days},
                        report.metrics.get("sharpe", float("nan")),
                        report.metrics.get("trades", 0), "in_sample")
    return report, equity, trades


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", nargs="*", default=None)
    ap.add_argument("--holding-days", nargs="*", type=float, default=[5.0, 3650.0])
    args = ap.parse_args()

    setup_logging("INFO", logfile="logs/breakout.log")
    cfg = load_config(args.config)
    md = load_market_data(cfg, split="in_sample", include_intrabar=True)
    start, end = split_bounds(cfg, "in_sample")
    registry = TrialRegistry.load(resolve_path(cfg, cfg.get_path("reports.output_dir")) / "trials.json")

    keys = list(GRID)
    combos = list(itertools.product(*[GRID[k] for k in keys]))
    rows, best = [], {}
    for holding in args.holding_days:
        tag = "5j" if holding <= 30 else "sans plafond"
        for i, values in enumerate(combos):
            params = dict(zip(keys, values))
            report, equity, trades = run(
                cfg, md, start, end, params, holding, registry, f"breakout_{tag}_{i:03d}"
            )
            m = report.metrics
            rows.append(
                {
                    "detention": tag, **params,
                    "trades": m.get("trades"), "sharpe": m.get("sharpe"),
                    "total_return": m.get("total_return"), "cagr": m.get("cagr"),
                    "max_drawdown": m.get("max_drawdown"), "win_rate": m.get("win_rate"),
                    "profit_factor": m.get("profit_factor"), "expectancy_r": m.get("expectancy_r"),
                    "gross_pnl": m.get("gross_pnl"), "costs_total": m.get("costs_total"),
                    "net_pnl": m.get("net_pnl"), "killed": m.get("killed"),
                    "avg_holding_hours": m.get("avg_holding_hours"),
                }
            )
            log.info("%s %s -> Sharpe %.2f | %s trades | %.1f%%", tag, params,
                     m.get("sharpe", float("nan")), m.get("trades"),
                     100 * (m.get("total_return") or 0))
            if best.get(tag) is None or (m.get("sharpe") or -99) > best[tag][0]:
                best[tag] = (m.get("sharpe"), params, equity, trades, report)

    table = pd.DataFrame(rows)
    out = ensure_dir(resolve_path(cfg, cfg.get_path("reports.output_dir")) / "tables")
    table.to_csv(out / "breakout_4h_grid.csv", index=False)

    # benchmark sur la même fenêtre
    bench = build_benchmarks(md.slice(start, end), cfg, include=["btc_buy_hold"])
    btc = bench.get("btc_buy_hold")
    btc_ret = float(btc.iloc[-1] / btc.iloc[0] - 1) if btc is not None and len(btc) else float("nan")

    print("\n=== Cassure de canal 4h — in-sample 2020-2023 ===")
    cols = ["detention", "entry_period", "exit_period", "atr_stop_mult", "trend_filter",
            "trades", "sharpe", "total_return", "max_drawdown", "profit_factor", "expectancy_r"]
    for tag, block in table.groupby("detention"):
        print(f"\n-- détention {tag} — {len(block)} combinaisons, "
              f"{int((block.sharpe > 0).sum())} avec Sharpe positif --")
        print(block.sort_values("sharpe", ascending=False)[cols].head(8).to_string(index=False))
    print(f"\nBTC buy & hold sur la même période : {btc_ret * 100:+.1f} %")

    for tag, (_, params, equity, trades, report) in best.items():
        equity.to_frame("equity").to_csv(out / f"breakout_equity_{tag.replace(' ', '_')}.csv")
        if len(trades):
            trades.to_csv(out / f"breakout_trades_{tag.replace(' ', '_')}.csv", index=False)
            by_symbol = summarize_by(trades, "symbol")
            print(f"\n-- meilleure config, détention {tag} : {params} --")
            print(by_symbol[["symbol", "trades", "win_rate", "profit_factor", "expectancy_r",
                             "net_pnl"]].to_string(index=False))
    print(f"\nEssais cumulés au registre (Deflated Sharpe) : {registry.n_trials}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
