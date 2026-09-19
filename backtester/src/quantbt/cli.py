"""Command-line entry point: run a backtest + full validation + HTML report.

Usage:
    quantbt run -c configs/backtest.yaml
    quantbt run -c configs/backtest.yaml -o reports/my_run.html
"""

from __future__ import annotations

import argparse
import logging
import random
import sys
from pathlib import Path

import numpy as np

from quantbt.config import RunConfig, load_config
from quantbt.data.loader import load_data
from quantbt.engine.backtester import run_backtest
from quantbt.metrics.core import compute_metrics
from quantbt.report.html import build_report
from quantbt.strategy.registry import get_strategy
from quantbt.validation.common import ValidationOutcome
from quantbt.validation.detrend import run_detrend
from quantbt.validation.montecarlo import run_montecarlo
from quantbt.validation.noise import run_noise
from quantbt.validation.oos import run_oos
from quantbt.validation.sensitivity import run_sensitivity
from quantbt.validation.verdict import compute_verdict
from quantbt.validation.walkforward import run_walkforward

logger = logging.getLogger("quantbt")


def run_pipeline(cfg: RunConfig, out_path: str | None = None) -> Path:
    random.seed(cfg.seed)
    np.random.seed(cfg.seed)

    logger.info("loading data (%s)", cfg.data.source)
    data = load_data(cfg.data)
    logger.info("%d bars from %s to %s", len(data.frame), data.frame.index[0], data.frame.index[-1])

    strategy = get_strategy(cfg.strategy.name, **cfg.strategy.params)
    result = run_backtest(data, strategy, cfg.costs, cfg.risk)
    metrics = compute_metrics(result)
    logger.info("baseline: %d trades, sharpe %.2f, maxDD %.1f%%",
                metrics.n_trades, metrics.sharpe, 100 * metrics.max_drawdown)

    v = cfg.validation
    outcomes: list[ValidationOutcome] = []
    if v.oos.enabled:
        logger.info("validation: out-of-sample split")
        outcomes.append(run_oos(data, strategy, cfg.costs, cfg.risk, v.oos,
                                cfg.strategy.param_grid))
    if v.walkforward.enabled:
        logger.info("validation: walk-forward")
        outcomes.append(run_walkforward(data, strategy, cfg.costs, cfg.risk, v.walkforward,
                                        cfg.strategy.param_grid))
    if v.montecarlo.enabled:
        logger.info("validation: monte-carlo")
        outcomes.append(run_montecarlo(result, v.montecarlo))
    if v.noise.enabled:
        logger.info("validation: noise test")
        outcomes.append(run_noise(data, strategy, cfg.costs, cfg.risk, v.noise))
    if v.detrend.enabled:
        logger.info("validation: detrend")
        outcomes.append(run_detrend(data, strategy, cfg.costs, cfg.risk, v.detrend))
    if v.sensitivity.enabled:
        logger.info("validation: parameter sensitivity")
        outcomes.append(run_sensitivity(data, strategy, cfg.costs, cfg.risk, v.sensitivity,
                                        cfg.strategy.param_grid))

    verdict = compute_verdict(outcomes)
    logger.info("VERDICT: %s (score %.0f%%)", verdict.label, 100 * verdict.score)
    for r in verdict.reasons:
        logger.info("  %s", r)

    path = build_report(result, metrics, outcomes, verdict, cfg.report, out_path)
    logger.info("report written to %s", path)
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="quantbt")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_run = sub.add_parser("run", help="run backtest + validation + report")
    p_run.add_argument("-c", "--config", required=True, help="YAML config path")
    p_run.add_argument("-o", "--output", default=None, help="report output path")
    p_run.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    cfg = load_config(args.config)
    run_pipeline(cfg, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
