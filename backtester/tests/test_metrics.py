from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from quantbt.engine.backtester import TRADE_COLUMNS, BacktestResult
from quantbt.metrics.core import compute_metrics, max_drawdown


def make_result(equity: list[float], trades: pd.DataFrame | None = None,
                bars_per_day: float = 96.0) -> BacktestResult:
    idx = pd.date_range("2024-01-01", periods=len(equity), freq="15min", tz="UTC")
    if trades is None:
        trades = pd.DataFrame(columns=TRADE_COLUMNS)
    return BacktestResult(pd.Series(equity, index=idx), trades, equity[0], bars_per_day)


def test_max_drawdown_simple():
    eq = pd.Series([100.0, 120.0, 90.0, 110.0])
    assert max_drawdown(eq) == pytest.approx(90 / 120 - 1)


def test_flat_equity_zero_metrics():
    m = compute_metrics(make_result([10_000.0] * 100))
    assert m.sharpe == 0.0
    assert m.max_drawdown == 0.0
    assert m.total_return == 0.0
    assert m.n_trades == 0


def test_cagr_annualizes_correctly():
    # +10% over exactly one year of 15m bars (96 bars/day * 365 days).
    n = 96 * 365
    eq = list(np.linspace(10_000, 11_000, n))
    m = compute_metrics(make_result(eq))
    assert m.cagr == pytest.approx(0.10, abs=0.005)


def test_trade_stats():
    trades = pd.DataFrame(
        {
            "pnl": [300.0, -100.0, 300.0, -100.0],
            "r_multiple": [3.0, -1.0, 3.0, -1.0],
            "bars_held": [10, 5, 10, 5],
            "return_pct": [0.03, -0.01, 0.03, -0.01],
        }
    )
    m = compute_metrics(make_result([10_000, 10_300, 10_200, 10_500, 10_400], trades))
    assert m.win_rate == pytest.approx(0.5)
    assert m.profit_factor == pytest.approx(600 / 200)
    assert m.expectancy_r == pytest.approx(1.0)
    assert m.n_trades == 4
