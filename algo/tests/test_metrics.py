"""Métriques : valeurs vérifiées à la main sur des séries construites."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from goldsilver.metrics.performance import compute_metrics, monthly_return_table


def _equity(values: list[float], start: str = "2024-01-01", freq: str = "1D") -> pd.Series:
    idx = pd.date_range(start, periods=len(values), freq=freq, tz="UTC")
    return pd.Series(values, index=idx, name="equity")


def _trades(pnls: list[float], risk: float = 100.0) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "pnl": pnls,
            "r_multiple": [p / risk for p in pnls],
            "bars_held": [10] * len(pnls),
            "swap_paid": [0.0] * len(pnls),
        }
    )


def test_total_return_and_cagr_two_years() -> None:
    n = int(365.25 * 2) + 1
    eq = _equity(list(np.linspace(10_000, 12_100, n)))
    m = compute_metrics(eq, _trades([100.0] * 10), 10_000)
    assert math.isclose(m.total_return, 0.21, abs_tol=1e-9)
    assert math.isclose(m.cagr, math.sqrt(1.21) - 1, rel_tol=1e-3)  # ~10 %/an


def test_max_drawdown_hand_computed() -> None:
    eq = _equity([10_000, 11_000, 9_000, 9_500, 11_500])
    m = compute_metrics(eq, _trades([1.0]), 10_000)
    assert math.isclose(m.max_drawdown, 2_000 / 11_000, rel_tol=1e-9)


def test_profit_factor_win_rate_expectancy() -> None:
    eq = _equity([10_000, 10_400])
    trades = _trades([300.0, -100.0, -100.0, 300.0])
    m = compute_metrics(eq, trades, 10_000)
    assert math.isclose(m.profit_factor, 600.0 / 200.0)
    assert math.isclose(m.win_rate, 0.5)
    assert math.isclose(m.expectancy_usd, 100.0)
    assert math.isclose(m.expectancy_r, 1.0)
    assert math.isclose(m.avg_win_usd, 300.0)
    assert math.isclose(m.avg_loss_usd, -100.0)


def test_monthly_stats_flat_growth() -> None:
    # +1 % par mois exactement, 12 mois
    monthly_eq = [10_000 * 1.01 ** k for k in range(1, 13)]
    idx = pd.date_range("2024-01-31", periods=12, freq="ME", tz="UTC")
    eq = pd.Series(monthly_eq, index=idx)
    m = compute_metrics(eq, _trades([1.0]), 10_000)
    assert math.isclose(m.monthly_mean, 0.01, rel_tol=1e-9)
    assert m.monthly_std < 1e-12
    assert m.pct_positive_months == 1.0


def test_monthly_table_shape() -> None:
    idx = pd.date_range("2024-01-01", periods=400, freq="1D", tz="UTC")
    eq = pd.Series(np.linspace(10_000, 12_000, 400), index=idx)
    table = monthly_return_table(eq, 10_000)
    assert 2024 in table.index and 2025 in table.index
    assert table.loc[2024].notna().sum() == 12


def test_sharpe_zero_when_flat() -> None:
    eq = _equity([10_000.0] * 100)
    m = compute_metrics(eq, _trades([]), 10_000)
    assert m.sharpe == 0.0
    assert m.n_trades == 0
