"""Shared helpers for validation modules: slicing, grid search, flags."""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any

from quantbt.config import CostConfig, RiskConfig
from quantbt.data.loader import MarketData
from quantbt.engine.backtester import run_backtest
from quantbt.metrics.core import Metrics, compute_metrics
from quantbt.strategy.base import Strategy


@dataclass(frozen=True)
class Flag:
    """One validation signal feeding the final verdict."""

    name: str
    status: str  # "pass" | "warn" | "fail"
    detail: str
    value: float | None = None


@dataclass
class ValidationOutcome:
    """Result of one validation module: flags + arbitrary payload for the report."""

    module: str
    flags: list[Flag] = field(default_factory=list)
    payload: dict[str, Any] = field(default_factory=dict)


def slice_data(data: MarketData, start: int, end: int) -> MarketData:
    """Positional slice [start, end) of the base frame, HTF columns included."""
    return data.with_frame(data.frame.iloc[start:end])


def evaluate(
    data: MarketData,
    strategy: Strategy,
    costs: CostConfig,
    risk: RiskConfig,
) -> Metrics:
    return compute_metrics(run_backtest(data, strategy, costs, risk))


def param_combinations(grid: dict[str, list[Any]]) -> list[dict[str, Any]]:
    keys = sorted(grid)
    return [dict(zip(keys, vals)) for vals in itertools.product(*(grid[k] for k in keys))]


def grid_search(
    data: MarketData,
    strategy: Strategy,
    grid: dict[str, list[Any]],
    costs: CostConfig,
    risk: RiskConfig,
    objective: str = "sharpe",
    min_trades: int = 5,
) -> tuple[dict[str, Any], Metrics, list[tuple[dict[str, Any], Metrics]]]:
    """Exhaustive grid search; returns (best_params, best_metrics, all results).

    The objective is any Metrics attribute. Runs with fewer than ``min_trades``
    trades are heavily penalized so a lucky 2-trade run (whose annualized
    Sharpe can be absurd) can't win; ties break toward more trades.
    """

    def score(m: Metrics) -> tuple[float, int]:
        val = getattr(m, objective)
        if m.n_trades < min_trades:
            val = float("-inf") if m.n_trades == 0 else min(val, 0.0)
        return (val, m.n_trades)

    results: list[tuple[dict[str, Any], Metrics]] = []
    best: tuple[dict[str, Any], Metrics] | None = None
    for params in param_combinations(grid):
        m = evaluate(data, strategy.with_params(**params), costs, risk)
        results.append((params, m))
        if best is None or score(m) > score(best[1]):
            best = (params, m)
    assert best is not None, "empty parameter grid"
    return best[0], best[1], results


def get_grid(strategy: Strategy, configured: dict[str, list[Any]]) -> dict[str, list[Any]]:
    grid = configured or strategy.default_param_grid()
    if not grid:
        raise ValueError(
            f"strategy '{strategy.name}' has no param_grid (config or default) — "
            "optimization-based validation needs one"
        )
    return grid
