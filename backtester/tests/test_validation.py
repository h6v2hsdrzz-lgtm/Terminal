from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from quantbt.config import (
    DetrendConfig,
    MonteCarloConfig,
    NoiseConfig,
    OOSConfig,
    SensitivityConfig,
    WalkForwardConfig,
)
from quantbt.engine.backtester import run_backtest
from quantbt.strategy.examples.ema_atr import EmaAtrStrategy
from quantbt.validation.common import Flag, param_combinations, slice_data
from quantbt.validation.detrend import detrend_prices, run_detrend
from quantbt.validation.montecarlo import run_montecarlo
from quantbt.validation.noise import perturb_prices, run_noise
from quantbt.validation.oos import run_oos
from quantbt.validation.sensitivity import run_sensitivity
from quantbt.validation.verdict import compute_verdict
from quantbt.validation.walkforward import run_walkforward
from quantbt.validation.common import ValidationOutcome

GRID = {"fast": [10, 20], "slow": [40, 60]}


@pytest.fixture(scope="module")
def strat():
    return EmaAtrStrategy(rr=2.0, trend_tf="")


def test_param_combinations_cartesian():
    combos = param_combinations(GRID)
    assert len(combos) == 4
    assert {"fast": 10, "slow": 40} in combos


def test_slice_data_positional(market_data):
    s = slice_data(market_data, 100, 200)
    assert len(s.frame) == 100
    assert s.frame.index[0] == market_data.frame.index[100]


def test_oos_split_and_flags(market_data, strat, cost_cfg, risk_cfg):
    out = run_oos(market_data, strat, cost_cfg, risk_cfg,
                  OOSConfig(train_ratio=0.7, optimize=True), GRID)
    assert out.module == "oos"
    assert out.payload["split_index"] == int(len(market_data.frame) * 0.7)
    assert {"in_sample", "out_of_sample", "best_params"} <= out.payload.keys()
    assert len(out.flags) >= 1


def test_walkforward_folds_never_overlap(market_data, strat, cost_cfg, risk_cfg):
    cfg = WalkForwardConfig(n_folds=3, train_bars=2000, test_bars=800)
    out = run_walkforward(market_data, strat, cost_cfg, risk_cfg, cfg, GRID)
    folds = out.payload["folds"]
    assert len(folds) == 3
    for f in folds:
        assert pd.Timestamp(f["train_range"][1]) < pd.Timestamp(f["test_range"][0])
    # Successive test windows must not overlap.
    for a, b in zip(folds, folds[1:]):
        assert pd.Timestamp(a["test_range"][1]) < pd.Timestamp(b["test_range"][0])


def test_walkforward_insufficient_data_warns(market_data, strat, cost_cfg, risk_cfg):
    cfg = WalkForwardConfig(n_folds=3, train_bars=10**6, test_bars=1000)
    out = run_walkforward(market_data, strat, cost_cfg, risk_cfg, cfg, GRID)
    assert out.flags[0].status == "warn"


def _result_with_trades(market_data, strat, cost_cfg, risk_cfg):
    return run_backtest(market_data, strat, cost_cfg, risk_cfg)


def test_montecarlo_deterministic_with_seed(market_data, strat, cost_cfg, risk_cfg):
    res = _result_with_trades(market_data, strat, cost_cfg, risk_cfg)
    cfg = MonteCarloConfig(n_runs=200, method="both", seed=123)
    a = run_montecarlo(res, cfg)
    b = run_montecarlo(res, cfg)
    if not a.payload:  # too few trades on this fixture would invalidate the test
        pytest.skip("not enough trades")
    assert a.payload["shuffle"]["final_equity_pct"] == b.payload["shuffle"]["final_equity_pct"]
    assert a.payload["shuffle"]["risk_of_ruin"] == b.payload["shuffle"]["risk_of_ruin"]


def test_montecarlo_shuffle_preserves_total_return(market_data, strat, cost_cfg, risk_cfg):
    res = _result_with_trades(market_data, strat, cost_cfg, risk_cfg)
    if len(res.trades) < 10:
        pytest.skip("not enough trades")
    out = run_montecarlo(res, MonteCarloConfig(n_runs=50, method="shuffle", seed=1))
    finals = out.payload["shuffle"]["finals"]
    expected = float(np.prod(1.0 + res.trades["return_pct"].to_numpy()))
    # Order changes drawdowns but never the compounded product.
    assert np.allclose(finals, expected, rtol=1e-9)


def test_noise_perturbation_keeps_bars_valid(market_data):
    rng = np.random.default_rng(0)
    noisy = perturb_prices(market_data, 0.2, 14, rng)
    f = noisy.frame
    assert (f["high"] >= f["low"]).all()
    assert (f["high"] >= f[["open", "close"]].max(axis=1) - 1e-12).all()
    assert not f["close"].equals(market_data.frame["close"])


def test_noise_run_produces_distribution(market_data, strat, cost_cfg, risk_cfg):
    cfg = NoiseConfig(n_runs=5, noise_atr_frac=0.05, seed=3)
    out = run_noise(market_data, strat, cost_cfg, risk_cfg, cfg)
    assert len(out.payload["distribution"]) == 5
    assert len(out.flags) == 1


def test_detrend_flattens_drift(market_data):
    det = detrend_prices(market_data)
    c0 = market_data.frame["close"]
    c1 = det.frame["close"]
    t = np.arange(len(c0))
    slope_raw = abs(np.polyfit(t, np.log(c0.to_numpy()), 1)[0])
    slope_det = abs(np.polyfit(t, np.log(c1.to_numpy()), 1)[0])
    assert slope_det < slope_raw * 0.01 + 1e-12


def test_detrend_run_returns_comparison(market_data, strat, cost_cfg, risk_cfg):
    out = run_detrend(market_data, strat, cost_cfg, risk_cfg, DetrendConfig())
    assert {"raw", "detrended", "edge_ratio"} <= out.payload.keys()


def test_sensitivity_heatmap_shape(market_data, strat, cost_cfg, risk_cfg):
    cfg = SensitivityConfig(metric="sharpe", params=("fast", "slow"))
    out = run_sensitivity(market_data, strat, cost_cfg, risk_cfg, cfg, GRID)
    heat = out.payload["heatmap"]
    assert heat.shape == (len(GRID["fast"]), len(GRID["slow"]))
    assert not heat.isna().any().any()


def test_verdict_labels():
    def outcome(module, status):
        return ValidationOutcome(module, [Flag(f"{module}.x", status, "d")])

    assert compute_verdict([outcome("oos", "pass"), outcome("noise", "pass")]).label == "ROBUST"
    assert compute_verdict([outcome("oos", "fail")]).label == "OVERFIT"
    assert compute_verdict([outcome("noise", "fail"), outcome("oos", "pass"),
                            outcome("detrend", "pass"), outcome("walkforward", "pass"),
                            outcome("montecarlo", "pass"), outcome("sensitivity", "pass"),
                            ]).label == "FRAGILE"
    assert compute_verdict([outcome("noise", "warn"), outcome("montecarlo", "warn"),
                            outcome("oos", "pass")]).label == "FRAGILE"
