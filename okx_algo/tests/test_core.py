"""Tests unitaires. Chaque brique doit etre testable seule (§4).

Ces tests tournent sur des donnees synthetiques : ils verifient des proprietes
structurelles (symetrie, absence de lookahead, comptabilite du moteur), pas des
niveaux de performance. Un test qui depend d'un resultat de backtest serait un
test de surajustement.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from okx_algo.backtest.metrics import cagr, max_drawdown, monthly_returns, sharpe
from okx_algo.core.persist import ComputeCache, RunState, stable_hash
from okx_algo.data.panel import Panel, SymbolData
from okx_algo.features.core import ewma_vol, log_return, shift1, zscore
from okx_algo.risk.engine import RiskEngine, RiskInvariantViolation, RiskLimits
from okx_algo.strategies.base import Brick
from okx_algo.strategies.cross_sectional import CrossSectionalMomentum
from okx_algo.strategies.ts_momentum import TSMomentum
from okx_algo.validation.statistics import (deflated_sharpe, expected_max_sharpe,
                                            purged_kfold_splits, walk_forward_splits)


# ----------------------------------------------------------------------
def synthetic_panel(n: int = 6000, symbols=("A", "B", "C"), seed: int = 0,
                    timeframe: str = "1H") -> Panel:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2021-01-01", periods=n, freq="1h", tz="UTC")
    data = {}
    for k, s in enumerate(symbols):
        ret = rng.normal(0, 0.01, n) + 0.0002 * np.sin(np.arange(n) / 300 + k)
        close = 100 * np.exp(np.cumsum(ret))
        high = close * (1 + np.abs(rng.normal(0, 0.002, n)))
        low = close * (1 - np.abs(rng.normal(0, 0.002, n)))
        data[s] = SymbolData(
            symbol=s, open=close, high=high, low=low, close=close,
            volume=np.full(n, 1000.0), volume_quote=np.full(n, 1e7),
            mark_high=high, mark_low=low, mark_close=close, index_close=close,
            funding=np.where(np.arange(n) % 8 == 0, 0.0001, 0.0),
            open_interest=np.full(n, 1e6), valid=np.ones(n, dtype=bool),
            m1_slice=np.zeros((n, 2), dtype=np.int64))
    return Panel(index=idx, symbols=list(symbols), data=data, timeframe=timeframe)


def base_params() -> dict:
    return {"horizons_hours": [24, 72, 168], "k": 1.0, "vol_halflife_days": 20,
            "deadband": 0.20, "rebalance_timeframe": "1H", "max_abs_position": 1.0,
            "target_vol_annualized": 0.10, "vol_estimator_window_days": 20}


# ----------------------------------------------------------------------
class TestFeatures:
    def test_shift1_uses_only_past(self):
        a = np.arange(10.0)
        s = shift1(a)
        assert np.isnan(s[0])
        assert (s[1:] == a[:-1]).all()

    def test_future_corruption_does_not_change_past(self):
        """Le test anti-lookahead du §10, sur les features elementaires."""
        rng = np.random.default_rng(1)
        close = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 3000)))
        cut = 1800
        corrupted = close.copy()
        corrupted[cut:] *= rng.uniform(0.2, 5.0, len(close) - cut)
        for fn in (lambda c: shift1(log_return(c, 168)),
                   lambda c: shift1(zscore(c, 500)),
                   lambda c: shift1(ewma_vol(np.diff(np.log(c), prepend=np.nan), 480))):
            a, b = fn(close)[:cut], fn(corrupted)[:cut]
            m = np.isfinite(a) & np.isfinite(b)
            assert np.allclose(a[m], b[m], atol=1e-12)

    def test_log_return_horizon(self):
        c = np.array([1.0, 2.0, 4.0, 8.0])
        r = log_return(c, 1)
        assert np.isnan(r[0])
        assert np.allclose(r[1:], np.log(2.0))


# ----------------------------------------------------------------------
class TestTSMomentum:
    def test_long_short_symmetry(self):
        """Retourner tous les prix doit retourner exactement toutes les positions.

        C'est la verification que la brique n'a AUCUN biais long code en dur.
        """
        panel = synthetic_panel(seed=3)
        mirrored = synthetic_panel(seed=3)
        for s in panel.symbols:
            c = panel.data[s].close
            inv = c[0] ** 2 / c            # reflexion multiplicative autour de c[0]
            d = mirrored.data[s]
            d.close, d.open = inv, inv
            d.high = inv * 1.001
            d.low = inv * 0.999
            d.mark_close = inv

        w1 = TSMomentum(base_params()).compute(panel).weights
        w2 = TSMomentum(base_params()).compute(mirrored).weights
        m = np.isfinite(w1) & np.isfinite(w2) & (np.abs(w1) > 1e-6)
        # correlation fortement negative : les signaux sont opposes
        assert np.corrcoef(w1[m], w2[m])[0, 1] < -0.9

    def test_weights_bounded_and_lagged(self):
        panel = synthetic_panel()
        out = TSMomentum(base_params()).compute(panel)
        assert out.weights.shape == (panel.n, len(panel.symbols))
        assert np.all(np.abs(out.weights) <= 1.0)
        assert out.weights[0].tolist() == [0.0] * len(panel.symbols)

    def test_no_long_bias(self):
        panel = synthetic_panel(seed=11)
        out = TSMomentum(base_params()).compute(panel)
        w = out.weights[out.weights != 0]
        assert abs((w > 0).mean() - 0.5) < 0.2

    def test_deadband_reduces_turnover(self):
        panel = synthetic_panel(seed=5)
        p_tight = base_params() | {"deadband": 0.0}
        p_wide = base_params() | {"deadband": 0.40}
        t = np.abs(np.diff(TSMomentum(p_tight).compute(panel).weights, axis=0)).sum()
        w = np.abs(np.diff(TSMomentum(p_wide).compute(panel).weights, axis=0)).sum()
        assert w < t

    def test_rebalance_grid_is_honoured(self):
        panel = synthetic_panel(seed=7)
        out = TSMomentum(base_params() | {"rebalance_timeframe": "4H"}).compute(panel)
        # Les poids sont figes hors frontieres 4H, PUIS decales d'une barre :
        # les changements apparaissent donc aux barres ou hour % 4 == 1.
        changed = np.abs(np.diff(out.weights, axis=0)).sum(axis=1) > 1e-12
        hours = panel.index.hour.to_numpy()[1:]
        assert changed[(hours % 4 != 1)].sum() == 0
        assert changed[(hours % 4 == 1)].sum() > 0


class TestCrossSectional:
    def test_dollar_neutral(self):
        panel = synthetic_panel(seed=9)
        out = CrossSectionalMomentum(
            {"lookback_hours": 168, "vol_halflife_days": 20, "rebalance_timeframe": "1D",
             "max_abs_position": 1.0}).compute(panel)
        longs = np.clip(out.weights, 0, None).sum(axis=1)
        shorts = np.clip(-out.weights, 0, None).sum(axis=1)
        active = (longs + shorts) > 1e-9
        assert np.allclose(longs[active], shorts[active], atol=1e-9)

    def test_median_gets_zero_weight(self):
        panel = synthetic_panel(seed=13, symbols=("A", "B", "C"))
        out = CrossSectionalMomentum(
            {"lookback_hours": 168, "vol_halflife_days": 20, "rebalance_timeframe": "1D",
             "max_abs_position": 1.0}).compute(panel)
        active = np.abs(out.weights).sum(axis=1) > 1e-9
        # sur 3 actifs, exactement un poids nul par ligne active
        assert ((np.abs(out.weights[active]) < 1e-12).sum(axis=1) == 1).all()


# ----------------------------------------------------------------------
class TestRiskEngine:
    def limits(self, **kw) -> RiskLimits:
        base = dict(leverage_effective_max=10.0, max_concurrent_positions=2,
                    cascade_slot=1, daily_dd_stop=-0.05, weekly_dd_stop=-0.12,
                    monthly_dd_stop=-0.25, global_kill_switch=-0.40,
                    risk_per_trade=0.01, stop_loss_required=True,
                    funding_cost_guard=0.30, funding_guard_reduction=0.5)
        base.update(kw)
        return RiskLimits(**base)

    def test_leverage_cap_refuses(self):
        r = RiskEngine(self.limits())
        r.start(100_000, pd.Timestamp("2022-01-01", tz="UTC"))
        ok, why = r.approve_order(equity=100_000, gross_notional_after=1_100_000,
                                  loss_at_stop=100, has_stop=True, n_positions_after=1,
                                  is_cascade=False, is_reducing=False)
        assert not ok and why == "levier_effectif_max"

    def test_position_cap_refuses(self):
        r = RiskEngine(self.limits())
        r.start(100_000, pd.Timestamp("2022-01-01", tz="UTC"))
        ok, why = r.approve_order(equity=100_000, gross_notional_after=10_000,
                                  loss_at_stop=100, has_stop=True, n_positions_after=3,
                                  is_cascade=False, is_reducing=False)
        assert not ok and why == "positions_simultanees_max"

    def test_missing_stop_refused(self):
        r = RiskEngine(self.limits())
        r.start(100_000, pd.Timestamp("2022-01-01", tz="UTC"))
        ok, why = r.approve_order(equity=100_000, gross_notional_after=10_000,
                                  loss_at_stop=100, has_stop=False, n_positions_after=1,
                                  is_cascade=False, is_reducing=False)
        assert not ok and why == "stop_loss_manquant"

    def test_reduction_always_allowed(self):
        r = RiskEngine(self.limits())
        r.start(100_000, pd.Timestamp("2022-01-01", tz="UTC"))
        ok, _ = r.approve_order(equity=100_000, gross_notional_after=99e6,
                                loss_at_stop=1e9, has_stop=False, n_positions_after=9,
                                is_cascade=False, is_reducing=True)
        assert ok

    def test_daily_stop_triggers_and_halts(self):
        r = RiskEngine(self.limits())
        t0 = pd.Timestamp("2022-01-01 00:00", tz="UTC")
        r.start(100_000, t0)
        assert r.update(t0 + pd.Timedelta(hours=1), 99_000) is None
        assert r.update(t0 + pd.Timedelta(hours=2), 94_000) == "flat_day"
        assert r.is_halted(t0 + pd.Timedelta(hours=3))
        assert not r.is_halted(t0 + pd.Timedelta(days=1, hours=1))

    def test_kill_switch_is_terminal(self):
        r = RiskEngine(self.limits())
        t0 = pd.Timestamp("2022-01-01", tz="UTC")
        r.start(100_000, t0)
        assert r.update(t0 + pd.Timedelta(hours=1), 55_000) == "kill"
        assert r.state.killed
        assert r.update(t0 + pd.Timedelta(days=40), 100_000) == "kill"

    def test_invariant_raises_on_breach(self):
        r = RiskEngine(self.limits())
        r.start(100_000, pd.Timestamp("2022-01-01", tz="UTC"))
        with pytest.raises(RiskInvariantViolation):
            r.assert_invariants(ts="t", equity=100_000, gross_notional=2_000_000,
                                n_positions=1, n_cascade=0, positions_without_stop=0)
        with pytest.raises(RiskInvariantViolation):
            r.assert_invariants(ts="t", equity=100_000, gross_notional=1000,
                                n_positions=1, n_cascade=0, positions_without_stop=1)

    def test_size_from_stop_scales_inversely_with_distance(self):
        r = RiskEngine(self.limits())
        r.start(100_000, pd.Timestamp("2022-01-01", tz="UTC"))
        near = r.size_from_stop(100_000, 100.0, 99.0, 1.0)
        far = r.size_from_stop(100_000, 100.0, 90.0, 1.0)
        assert near > far
        assert np.isclose(near * 1.0, 1000.0)          # 1 % de 100 000 / distance 1


# ----------------------------------------------------------------------
class TestMetrics:
    def test_sharpe_of_constant_is_zero(self):
        r = pd.Series(np.zeros(1000))
        assert sharpe(r) == 0.0

    def test_max_drawdown(self):
        eq = pd.Series([100, 120, 90, 110], index=pd.date_range("2022", periods=4, freq="h"))
        mdd, _, _ = max_drawdown(eq)
        assert np.isclose(mdd, 90 / 120 - 1)

    def test_cagr_doubling_in_one_year(self):
        idx = pd.date_range("2022-01-01", "2023-01-01", freq="h", tz="UTC")
        eq = pd.Series(np.linspace(100, 200, len(idx)), index=idx)
        assert 0.95 < cagr(eq) < 1.05

    def test_monthly_returns_count(self):
        idx = pd.date_range("2022-01-01", "2022-06-30", freq="h", tz="UTC")
        eq = pd.Series(np.linspace(100, 130, len(idx)), index=idx)
        assert len(monthly_returns(eq)) == 6


class TestStatistics:
    def test_expected_max_sharpe_grows_with_trials(self):
        a = expected_max_sharpe(10, 0.01)
        b = expected_max_sharpe(500, 0.01)
        assert b > a > 0

    def test_dsr_penalises_more_trials(self):
        rng = np.random.default_rng(0)
        r = pd.Series(rng.normal(0.0002, 0.01, 5000))
        few = deflated_sharpe(r, n_trials=2)
        many = deflated_sharpe(r, n_trials=500)
        assert many["p_value"] >= few["p_value"]

    def test_walk_forward_windows_do_not_overlap(self):
        idx = pd.date_range("2020-01-01", "2024-12-31", freq="h", tz="UTC")
        sp = walk_forward_splits(idx, 12, 3, "anchored")
        assert len(sp) > 0
        for a, b in zip(sp, sp[1:]):
            assert a["test_end"] <= b["test_start"]
            assert a["train_end"] <= a["test_start"]

    def test_purged_kfold_embargo_excludes_neighbours(self):
        idx = pd.date_range("2021-01-01", "2022-01-01", freq="h", tz="UTC")
        folds = purged_kfold_splits(idx, 5, embargo_days=5)
        assert len(folds) == 5
        for f in folds:
            train_idx = idx[f["train_mask"]]
            assert (train_idx < f["test_start"] - pd.Timedelta(days=5)).sum() + \
                   (train_idx > f["test_end"] + pd.Timedelta(days=5)).sum() == len(train_idx)


# ----------------------------------------------------------------------
class TestPersistence:
    def test_stable_hash_is_order_independent(self):
        assert stable_hash({"a": 1, "b": [1, 2]}) == stable_hash({"b": [1, 2], "a": 1})

    def test_cache_does_not_recompute(self, tmp_path):
        cache = ComputeCache(tmp_path, "t")
        calls = []

        def fn():
            calls.append(1)
            return 42

        assert cache.get_or_compute({"x": 1}, fn) == 42
        assert cache.get_or_compute({"x": 1}, fn) == 42
        assert len(calls) == 1

    def test_run_state_survives_reload(self, tmp_path):
        p = tmp_path / "run_state.json"
        s = RunState(p)
        s.mark_done("etape_a", rows=10)
        s.set("phase", "brique1")
        again = RunState(p)
        assert again.is_done("etape_a")
        assert again.get("phase") == "brique1"
        assert not again.is_done("etape_b")


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
