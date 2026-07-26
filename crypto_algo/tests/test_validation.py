"""Protocole de validation (§8) : les outils d'audit doivent être justes.

Un outil de validation faux est pire qu'aucun outil : il donne une fausse
assurance. Ces tests vérifient que Monte Carlo, DSR, walk-forward, purge et
métriques se comportent comme annoncé sur des cas connus.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from crypto_algo.config import load_config
from crypto_algo.reports.metrics import (
    cagr, calmar, compute_metrics, max_drawdown, max_drawdown_duration_days,
    sharpe, sortino, ulcer_index, value_at_risk,
)
from crypto_algo.validation.deflated_sharpe import (
    TrialRegistry, deflated_sharpe_ratio, expected_max_sharpe, probabilistic_sharpe_ratio,
)
from crypto_algo.validation.monte_carlo import run_monte_carlo
from crypto_algo.validation.robustness import alpha_beta, plateau_score
from crypto_algo.validation.splits import (
    embargo_timedelta, purged_kfold_windows, train_segments, walk_forward_windows,
)


@pytest.fixture()
def cfg():
    return load_config()


def make_equity(daily_returns, start="2021-01-01"):
    idx = pd.date_range(start, periods=len(daily_returns), freq="D", tz="UTC")
    return pd.Series(10_000 * np.cumprod(1 + np.asarray(daily_returns)), index=idx)


def make_trades(net_pnls, equity0=10_000.0):
    rows, equity = [], equity0
    for i, pnl in enumerate(net_pnls):
        equity += pnl
        rows.append(
            {
                "symbol": "BTC/USDT:USDT", "side": "long", "quantity": 1.0,
                "entry_price": 100.0, "exit_price": 101.0,
                "opened_at": pd.Timestamp("2021-01-01", tz="UTC") + pd.Timedelta(hours=i),
                "closed_at": pd.Timestamp("2021-01-01", tz="UTC") + pd.Timedelta(hours=i + 1),
                "gross_pnl": pnl, "fees": 1.0, "funding": 0.0, "slippage": 0.5,
                "net_pnl": pnl, "r_multiple": pnl / 150.0, "exit_reason": "signal",
                "resolved_with": "", "margin": 500.0, "leverage": 10.0, "risk_amount": 150.0,
                "bars_held": 4, "equity_after": equity, "regime": "range", "families": "",
                "holding_hours": 1.0,
            }
        )
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ métriques
def test_cagr_on_a_known_doubling():
    idx = pd.date_range("2021-01-01", periods=366, freq="D", tz="UTC")
    equity = pd.Series(np.linspace(10_000, 20_000, len(idx)), index=idx)
    assert cagr(equity) == pytest.approx(1.0, rel=0.02)


def test_max_drawdown_is_exact():
    equity = make_equity([0.10, -0.50, 0.20])
    assert max_drawdown(equity) == pytest.approx(-0.50, abs=1e-9)


def test_drawdown_duration_counts_days_under_water():
    equity = pd.Series(
        [100, 90, 80, 95, 110],
        index=pd.date_range("2021-01-01", periods=5, freq="D", tz="UTC"),
    )
    assert max_drawdown_duration_days(equity) == pytest.approx(2.0)


def test_sharpe_of_constant_returns_is_infinite_or_nan():
    flat = pd.Series([0.001] * 100)
    assert not np.isfinite(sharpe(flat)) or sharpe(flat) > 100


def test_sortino_penalizes_only_downside():
    rng = np.random.default_rng(3)
    r = pd.Series(rng.normal(0.001, 0.01, 500))
    assert sortino(r) > sharpe(r)


def test_ulcer_index_is_zero_for_monotonic_growth():
    equity = make_equity([0.01] * 50)
    assert ulcer_index(equity) == pytest.approx(0.0, abs=1e-9)


def test_var_is_a_left_tail_quantile():
    rng = np.random.default_rng(5)
    r = pd.Series(rng.normal(0, 0.02, 5000))
    assert value_at_risk(r, 0.95) < 0
    assert value_at_risk(r, 0.99) < value_at_risk(r, 0.95)


def test_calmar_matches_cagr_over_max_drawdown():
    equity = make_equity([0.02, -0.10, 0.03] * 60)
    assert calmar(equity) == pytest.approx(cagr(equity) / abs(max_drawdown(equity)), rel=1e-9)


def test_metrics_report_counts_costs_against_gross_pnl():
    trades = make_trades([100.0, -50.0, 30.0])
    report = compute_metrics(make_equity([0.01, -0.005, 0.003]), trades, name="t")
    assert report.metrics["trades"] == 3
    assert report.metrics["costs_total"] > 0
    assert np.isfinite(report.metrics["costs_over_gross_pnl"])


# ---------------------------------------------------------------- Monte Carlo
def test_monte_carlo_ruin_probability_is_one_for_a_ruinous_strategy():
    """Quatre trades perdant chacun la moitié de l'equity : -93 % quel que soit
    l'ordre de tirage. La ruine doit être certaine."""
    rows, equity = [], 10_000.0
    for i in range(4):
        loss = -equity / 2
        equity += loss
        rows.append({**make_trades([loss]).iloc[0].to_dict(), "net_pnl": loss, "equity_after": equity})
    trades = pd.DataFrame(rows)
    mc = run_monte_carlo(trades, n_simulations=500, ruin_threshold=-0.60, seed=1)
    assert mc.ruin_probability == pytest.approx(1.0)


def test_monte_carlo_ruin_probability_is_zero_for_a_monotonic_winner():
    trades = make_trades([100.0] * 40)
    mc = run_monte_carlo(trades, n_simulations=500, ruin_threshold=-0.60, seed=1)
    assert mc.ruin_probability == pytest.approx(0.0)


def test_monte_carlo_shuffle_preserves_the_final_multiple():
    """Permuter l'ordre ne change pas le produit des rendements relatifs."""
    trades = make_trades([120.0, -80.0, 60.0, -40.0, 200.0])
    mc = run_monte_carlo(trades, n_simulations=200, method="shuffle", seed=2)
    assert np.std(mc.final_equity) == pytest.approx(0.0, abs=1e-9)


def test_monte_carlo_bootstrap_produces_dispersion():
    trades = make_trades([120.0, -80.0, 60.0, -40.0, 200.0] * 6)
    mc = run_monte_carlo(trades, n_simulations=500, method="bootstrap_trades", seed=3)
    assert np.std(mc.final_equity) > 0


def test_monte_carlo_is_reproducible():
    trades = make_trades([50.0, -30.0] * 20)
    a = run_monte_carlo(trades, n_simulations=300, seed=7)
    b = run_monte_carlo(trades, n_simulations=300, seed=7)
    assert np.allclose(a.max_drawdowns, b.max_drawdowns)


# --------------------------------------------------------- Deflated Sharpe
def test_expected_max_sharpe_grows_with_the_number_of_trials():
    a = expected_max_sharpe(10, 0.01)
    b = expected_max_sharpe(1000, 0.01)
    assert b > a > 0


def test_deflated_sharpe_falls_when_trials_increase():
    rng = np.random.default_rng(11)
    returns = pd.Series(rng.normal(0.0015, 0.01, 800))
    few = deflated_sharpe_ratio(returns, n_trials=1)
    many = deflated_sharpe_ratio(returns, n_trials=5000)
    assert many["dsr"] < few["dsr"]
    assert few["sharpe"] == pytest.approx(many["sharpe"])


def test_psr_is_high_for_an_obviously_good_track_record():
    rng = np.random.default_rng(13)
    returns = pd.Series(rng.normal(0.004, 0.005, 1000))
    assert probabilistic_sharpe_ratio(float(returns.mean() / returns.std(ddof=1)), 0.0, len(returns)) > 0.99


def test_trial_registry_counts_every_configuration(tmp_path):
    registry = TrialRegistry.load(tmp_path / "trials.json")
    for i in range(7):
        registry.record(f"run_{i}", {"entry_threshold": 0.3 + i * 0.01}, sharpe=0.5, trades=100, split="in_sample")
    reloaded = TrialRegistry.load(tmp_path / "trials.json")
    assert registry.n_trials == 7 and reloaded.n_trials == 7
    assert len(reloaded.sharpes()) == 7


# ------------------------------------------------------------------ plateau
def test_plateau_score_distinguishes_a_plateau_from_a_spike():
    plateau = pd.DataFrame({"sharpe": [1.0, 1.02, 0.98, 1.01, 0.99, 1.0]})
    spike = pd.DataFrame({"sharpe": [2.0, 0.05, 0.02, 0.01, 0.03, 0.0, 0.02, 0.01]})
    assert plateau_score(plateau)["plateau_ratio"] > 0.9
    assert plateau_score(spike)["plateau_ratio"] < 0.5


# ------------------------------------------------------------------- splits
def test_walk_forward_windows_do_not_overlap_train_and_test(cfg):
    windows = walk_forward_windows("2020-01-01", "2023-01-01", cfg, mode="anchored")
    assert len(windows) > 5
    embargo = embargo_timedelta(cfg)
    for w in windows:
        assert w.test_start >= w.train_end + embargo
        assert w.test_end > w.test_start


def test_anchored_walk_forward_keeps_the_same_start(cfg):
    windows = walk_forward_windows("2020-01-01", "2023-01-01", cfg, mode="anchored")
    assert len({w.train_start for w in windows}) == 1


def test_rolling_walk_forward_moves_the_start(cfg):
    windows = walk_forward_windows("2020-01-01", "2023-01-01", cfg, mode="rolling")
    assert len({w.train_start for w in windows}) == len(windows)


def test_purged_kfold_train_segments_exclude_the_embargo(cfg):
    windows = purged_kfold_windows("2020-01-01", "2023-01-01", cfg, n_splits=5)
    embargo = embargo_timedelta(cfg)
    assert len(windows) == 5
    for w in windows:
        for seg_start, seg_end in train_segments(w, cfg):
            assert seg_end <= w.test_start - embargo or seg_start >= w.test_end + embargo


def test_embargo_covers_both_warmup_and_trade_horizon(cfg):
    embargo = embargo_timedelta(cfg)
    assert embargo >= pd.Timedelta(days=float(cfg.get_path("risk.max_holding_days")))


# --------------------------------------------------------------- alpha/beta
def test_beta_of_a_leveraged_copy_is_the_leverage():
    rng = np.random.default_rng(17)
    bench_returns = rng.normal(0.001, 0.02, 400)
    bench = make_equity(bench_returns)
    strat = make_equity(bench_returns * 2.0)
    result = alpha_beta(strat, bench)
    assert result["beta"] == pytest.approx(2.0, rel=0.1)
    assert abs(result["alpha_period"]) < 1e-3
    assert result["r_squared"] > 0.95


def test_alpha_is_detected_when_it_exists():
    rng = np.random.default_rng(19)
    bench_returns = rng.normal(0.0005, 0.02, 600)
    bench = make_equity(bench_returns)
    strat = make_equity(bench_returns * 0.5 + 0.003)
    result = alpha_beta(strat, bench)
    assert result["alpha_period"] > 0.002
    assert result["alpha_significant_5pct"]


def test_plateau_score_refuses_to_qualify_a_negative_region():
    """Toutes les combinaisons perdantes : le ratio de plateau n'a pas de sens.

    Sans ce garde-fou, des voisins « plus mauvais » que le meilleur point
    donneraient un ratio supérieur à 1, qui se lirait comme un plateau robuste
    alors qu'aucune configuration ne gagne.
    """
    all_negative = pd.DataFrame({"sharpe": [-1.1, -1.4, -1.8, -2.0, -1.6, -1.3]})
    result = plateau_score(all_negative)
    assert result["has_positive_region"] is False
    assert np.isnan(result["plateau_ratio"])
    assert result["best"] == pytest.approx(-1.1)


# ------------------------------------------------------------------- verdict
def test_verdict_requires_all_core_checks():
    """Trois contrôles cœur : sans eux, aucun verdict favorable n'est possible."""
    from crypto_algo.validation.verdict import build_verdict

    good_is = {"sharpe": 0.9, "cagr": 0.6, "trades": 500, "monthly_mean": 0.04}
    v = build_verdict(
        is_metrics=good_is,
        oos_metrics={"total_return": -0.2, "sharpe": 0.8},     # OOS négatif
        walk_forward={"anchored": {"windows": pd.DataFrame({"test_sharpe": [0.5, 0.6]})}},
        plateau={"plateau_ratio": 0.9, "has_positive_region": True},
        cost_stress=pd.DataFrame({"cost_multiplier": [1.0, 2.0], "sharpe_retention": [1.0, 0.8]}),
        benchmark_cagr=0.3,
    )
    assert v.label == "NON VALIDÉ"
    assert v.n_core_passed == 2 and len(v.core) == 3


def test_verdict_is_robust_when_everything_passes():
    from crypto_algo.validation.verdict import build_verdict

    v = build_verdict(
        is_metrics={"sharpe": 0.9, "cagr": 0.6, "trades": 500},
        oos_metrics={"total_return": 0.35, "sharpe": 0.8},
        walk_forward={"anchored": {"windows": pd.DataFrame({"test_sharpe": [0.4, 0.6]})}},
        plateau={"plateau_ratio": 0.9, "has_positive_region": True},
        cost_stress=pd.DataFrame({"cost_multiplier": [1.0, 2.0], "sharpe_retention": [1.0, 0.8]}),
        benchmark_cagr=0.3,
    )
    assert v.label == "ROBUSTE"
    assert v.n_passed == len(v.checks) == 7


def test_verdict_detects_degradation():
    from crypto_algo.validation.verdict import build_verdict

    v = build_verdict(
        is_metrics={"sharpe": 1.5, "cagr": 0.6, "trades": 500},
        oos_metrics={"total_return": 0.05, "sharpe": 0.2},   # -1,3 de Sharpe
        walk_forward={"anchored": {"windows": pd.DataFrame({"test_sharpe": [0.4]})}},
        plateau={"plateau_ratio": 0.9, "has_positive_region": True},
        cost_stress=pd.DataFrame({"cost_multiplier": [1.0, 2.0], "sharpe_retention": [1.0, 0.9]}),
        benchmark_cagr=0.3,
    )
    degradation = [c for c in v.checks if c.key == "dégradation"][0]
    assert not degradation.passed
    assert v.label == "NON VALIDÉ"


def test_monthly_statement_says_when_target_is_missed():
    from crypto_algo.validation.verdict import monthly_statement

    text = monthly_statement(
        {"monthly_mean": 0.0057, "monthly_median": 0.004, "monthly_std": 0.0164, "months": 27},
        target=0.38,
    )
    assert "n'est pas atteinte" in text
    assert "+0.57" in text


def test_every_validation_runner_in_the_orchestrator_receives_its_strategy():
    """Régression : un ``ValidationRunner`` construit sans ``strategy_factory``
    retombe silencieusement sur la stratégie assemblée par défaut.

    L'étude de ruine a été calculée ainsi pendant un temps : elle décrivait une
    *autre* stratégie que celle auditée, sans aucun message d'erreur. Le seul
    garde-fou fiable est de refuser toute construction implicite dans
    l'orchestrateur.
    """
    import re
    from pathlib import Path

    src = (Path(__file__).resolve().parents[2] / "scripts" / "run_research.py").read_text()
    calls = re.findall(r"ValidationRunner\((?:[^()]|\([^()]*\))*\)", src)
    assert calls, "aucun appel à ValidationRunner trouvé — le test ne garde plus rien"
    manquants = [c for c in calls if "strategy_factory" not in c]
    assert not manquants, (
        "ValidationRunner construit sans strategy_factory dans run_research.py : "
        + " | ".join(" ".join(c.split()) for c in manquants)
    )
