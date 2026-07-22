"""In-sample / out-of-sample split with degradation detection.

Optionally optimizes on the train slice first (the honest setup: judge the
OOS performance of parameters chosen on IS data, exactly like live trading
would). Degradation of the objective metric beyond the configured threshold
raises the overfitting flag.
"""

from __future__ import annotations

from quantbt.config import CostConfig, OOSConfig, RiskConfig
from quantbt.data.loader import MarketData
from quantbt.strategy.base import Strategy
from quantbt.validation.common import (
    Flag,
    ValidationOutcome,
    evaluate,
    get_grid,
    grid_search,
    slice_data,
)


def run_oos(
    data: MarketData,
    strategy: Strategy,
    costs: CostConfig,
    risk: RiskConfig,
    cfg: OOSConfig,
    param_grid: dict | None = None,
) -> ValidationOutcome:
    n = len(data.frame)
    split = int(n * cfg.train_ratio)
    train = slice_data(data, 0, split)
    test = slice_data(data, split, n)

    if cfg.optimize:
        grid = get_grid(strategy, param_grid or {})
        best_params, is_metrics, _ = grid_search(train, strategy, grid, costs, risk, cfg.objective)
        chosen = strategy.with_params(**best_params)
    else:
        chosen = strategy
        best_params = dict(strategy.params)
        is_metrics = evaluate(train, chosen, costs, risk)

    oos_metrics = evaluate(test, chosen, costs, risk)

    is_val = getattr(is_metrics, cfg.objective)
    oos_val = getattr(oos_metrics, cfg.objective)
    retention = oos_val / is_val if is_val > 0 else float("-inf")

    flags: list[Flag] = []
    if is_val <= 0:
        flags.append(Flag("oos.in_sample_edge", "fail",
                          f"in-sample {cfg.objective} is non-positive ({is_val:.2f})", is_val))
    elif oos_val <= 0:
        flags.append(Flag("oos.degradation", "fail",
                          f"OOS {cfg.objective} non-positive ({oos_val:.2f}) vs IS {is_val:.2f} "
                          "— classic overfitting signature", retention))
    elif retention < cfg.degradation_warn:
        flags.append(Flag("oos.degradation", "warn",
                          f"OOS keeps only {retention:.0%} of IS {cfg.objective} "
                          f"(threshold {cfg.degradation_warn:.0%})", retention))
    else:
        flags.append(Flag("oos.degradation", "pass",
                          f"OOS retains {retention:.0%} of IS {cfg.objective}", retention))

    return ValidationOutcome(
        module="oos",
        flags=flags,
        payload={
            "split_index": split,
            "split_time": str(data.frame.index[split]) if split < n else None,
            "best_params": best_params,
            "in_sample": is_metrics.as_dict(),
            "out_of_sample": oos_metrics.as_dict(),
            "retention": retention,
        },
    )
