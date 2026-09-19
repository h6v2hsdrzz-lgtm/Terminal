from __future__ import annotations

from quantbt.config import (
    MonteCarloConfig,
    NoiseConfig,
    ReportConfig,
    SensitivityConfig,
)
from quantbt.engine.backtester import run_backtest
from quantbt.metrics.core import compute_metrics
from quantbt.report.html import build_report
from quantbt.strategy.examples.ema_atr import EmaAtrStrategy
from quantbt.validation.montecarlo import run_montecarlo
from quantbt.validation.noise import run_noise
from quantbt.validation.sensitivity import run_sensitivity
from quantbt.validation.verdict import compute_verdict


def test_report_generation(tmp_path, market_data, cost_cfg, risk_cfg):
    strat = EmaAtrStrategy(rr=2.0, trend_tf="")
    result = run_backtest(market_data, strat, cost_cfg, risk_cfg)
    metrics = compute_metrics(result)
    outcomes = [
        run_montecarlo(result, MonteCarloConfig(n_runs=100, seed=1)),
        run_noise(market_data, strat, cost_cfg, risk_cfg, NoiseConfig(n_runs=3, seed=1)),
        run_sensitivity(market_data, strat, cost_cfg, risk_cfg,
                        SensitivityConfig(params=("fast", "slow")),
                        {"fast": [10, 20], "slow": [40, 60]}),
    ]
    verdict = compute_verdict(outcomes)
    out = build_report(result, metrics, outcomes, verdict,
                       ReportConfig(title="Test report"), tmp_path / "r.html")
    html = out.read_text()
    assert "VERDICT" in html
    assert verdict.label in html
    assert "plotly" in html.lower()
    assert out.stat().st_size > 10_000
