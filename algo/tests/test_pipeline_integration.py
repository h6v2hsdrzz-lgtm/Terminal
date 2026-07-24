"""Intégration bout-en-bout sur données synthétiques + déterminisme des seeds."""

from __future__ import annotations

import numpy as np
import pandas as pd

from goldsilver.pipeline import run_backtest, slice_market
from goldsilver.validation.detrend import detrend_ohlcv
from goldsilver.validation.monte_carlo import run_monte_carlo
from goldsilver.validation.noise import perturb_ohlcv
from tests.conftest import random_walk_ohlcv


def _market() -> dict[str, pd.DataFrame]:
    return {
        "XAUUSD": random_walk_ohlcv(n=6000, seed=1, s0=2000.0, vol=0.002),
        "XAGUSD": random_walk_ohlcv(n=6000, seed=2, s0=25.0, vol=0.004),
    }


def test_full_pipeline_runs_and_is_deterministic(make_cfg) -> None:
    cfg = make_cfg()
    market = _market()
    rr1 = run_backtest(market, cfg)
    rr2 = run_backtest(market, cfg)
    pd.testing.assert_series_equal(rr1.equity, rr2.equity)
    assert rr1.metrics.n_trades == rr2.metrics.n_trades
    assert rr1.metrics.n_trades > 0            # la stratégie trade bien
    # equity finale cohérente avec la somme des PnL
    assert np.isclose(
        rr1.equity.iloc[-1], 10_000.0 + rr1.trades["pnl"].sum(), atol=1e-6
    )


def test_no_trade_before_clips_entries(make_cfg) -> None:
    cfg = make_cfg()
    market = _market()
    cut = market["XAUUSD"].index[3000]
    sliced = slice_market(market, cut, None, warmup=pd.Timedelta(days=30))
    rr = run_backtest(sliced, cfg, no_trade_before=cut)
    assert rr.equity.index[0] >= cut
    if len(rr.trades):
        assert (rr.trades["entry_time"] >= cut).all()


def test_monte_carlo_deterministic_and_shapes(make_cfg) -> None:
    cfg = make_cfg()
    trades = pd.DataFrame({"pnl_pct": np.random.default_rng(3).normal(0.001, 0.01, 80)})
    mc1 = run_monte_carlo(trades, cfg.validation.monte_carlo, seed=42)
    mc2 = run_monte_carlo(trades, cfg.validation.monte_carlo, seed=42)
    assert np.allclose(mc1.shuffle.final_returns, mc2.shuffle.final_returns)
    assert mc1.shuffle.final_returns.shape == (200,)
    # le reshuffle ne change pas le rendement final (mêmes trades, autre ordre)
    expected = float(np.prod(1 + trades["pnl_pct"].to_numpy()) - 1)
    assert np.allclose(mc1.shuffle.final_returns, expected)
    # le bootstrap, lui, en change (tirage avec remise)
    assert not np.allclose(mc1.bootstrap.final_returns, expected)


def test_perturb_ohlcv_preserves_consistency() -> None:
    df = random_walk_ohlcv(n=500, seed=5)
    noisy = perturb_ohlcv(df, atr_frac=0.2, rng=np.random.default_rng(0))
    assert (noisy["high"] >= noisy[["open", "close"]].max(axis=1) - 1e-9).all()
    assert (noisy["low"] <= noisy[["open", "close"]].min(axis=1) + 1e-9).all()
    assert (noisy[["open", "high", "low", "close"]] > 0).all().all()
    assert not np.allclose(noisy["close"], df["close"])   # le bruit bruite


def test_detrend_removes_drift() -> None:
    df = random_walk_ohlcv(n=4000, seed=6, vol=0.001)
    # ajoute une forte dérive artificielle
    drift = np.exp(np.linspace(0, 0.5, len(df)))
    for col in ("open", "high", "low", "close"):
        df[col] = df[col] * drift
    detrended, mu = detrend_ohlcv(df)
    assert mu > 0
    residual = abs(detrended["close"].iloc[-1] / detrended["close"].iloc[0] - 1)
    original = abs(df["close"].iloc[-1] / df["close"].iloc[0] - 1)
    assert residual < original * 0.2           # la dérive de fond a disparu
