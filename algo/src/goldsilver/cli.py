"""Point d'entrée : ``goldsilver {fetch|backtest|validate} -c config/default.yaml``."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from goldsilver.config import Config, load_config

log = logging.getLogger("goldsilver")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


def cmd_fetch(cfg: Config) -> int:
    from goldsilver.data.fetch_dukascopy import fetch_all

    paths = fetch_all(cfg.fetch, cfg.root)
    for p in paths:
        log.info("OK : %s", p)
    return 0


def _data_summary(market: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for a, df in market.items():
        spread = df["spread"] if "spread" in df.columns else None
        out[a] = {
            "bars": len(df),
            "start": str(df.index[0]),
            "end": str(df.index[-1]),
            "median_spread": round(float(spread.median()), 4) if spread is not None else "n/a",
            "spread_p90": round(float(spread.quantile(0.9)), 4) if spread is not None else "n/a",
        }
    return out


def cmd_backtest(cfg: Config) -> int:
    from goldsilver.data.loader import load_market
    from goldsilver.pipeline import run_backtest

    market = load_market(cfg)
    rr = run_backtest(market, cfg)
    m = rr.metrics
    log.info("Backtest complet (paramètres par défaut) %s -> %s", m.start, m.end)
    for k, v in m.to_dict().items():
        log.info("  %-28s %s", k, v)
    return 0


def cmd_validate(cfg: Config) -> int:
    from goldsilver.data.loader import load_market
    from goldsilver.pipeline import run_backtest
    from goldsilver.report.html_report import ReportInputs, write_report
    from goldsilver.report.verdict import build_verdict
    from goldsilver.validation.detrend import run_detrend_test
    from goldsilver.validation.monte_carlo import run_monte_carlo
    from goldsilver.validation.noise import run_noise_test
    from goldsilver.validation.oos import run_oos
    from goldsilver.validation.sensitivity import run_sensitivity
    from goldsilver.validation.walk_forward import run_walk_forward

    np.random.seed(cfg.seed)  # filets de sécurité ; chaque module a son Generator seedé
    t0 = time.time()
    market = load_market(cfg)
    summary_data = _data_summary(market)

    log.info("=== 1/7 backtest complet (référence) ===")
    full_run = run_backtest(market, cfg)

    log.info("=== 2/7 out-of-sample ===")
    oos = run_oos(market, cfg)

    log.info("=== 3/7 walk-forward ===")
    wf = run_walk_forward(market, cfg)

    log.info("=== 4/7 Monte-Carlo ===")
    mc_trades = oos.default_oos.trades if len(oos.default_oos.trades) >= 30 else full_run.trades
    mc_scope = "OOS" if mc_trades is oos.default_oos.trades else "backtest complet"
    mc = run_monte_carlo(mc_trades, cfg.validation.monte_carlo, cfg.seed)
    log.info("Monte-Carlo sur les trades %s (%d trades)", mc_scope, mc.n_trades)

    log.info("=== 5/7 noise test ===")
    noise = run_noise_test(market, cfg)

    log.info("=== 6/7 detrending ===")
    detrend = run_detrend_test(market, cfg)

    log.info("=== 7/7 sensibilité ===")
    sens = run_sensitivity(market, cfg)

    verdict = build_verdict(oos, wf, mc, noise, detrend, sens, cfg.report)

    out_dir = cfg.resolve(cfg.report.out_dir)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    report_path = write_report(
        ReportInputs(cfg=cfg, full_run=full_run, oos=oos, wf=wf, mc=mc,
                     noise=noise, detrend=detrend, sens=sens, verdict=verdict,
                     data_summary=summary_data),
        out_dir / f"validation_{stamp}.html",
    )

    summary = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "verdict": verdict.label,
        "checks": [
            {"name": c.name, "passed": c.passed, "core": c.core,
             "value": c.value, "threshold": c.threshold}
            for c in verdict.checks
        ],
        "oos_monthly_mean_pct": round(100 * verdict.oos_monthly_mean, 3),
        "oos_monthly_std_pct": round(100 * verdict.oos_monthly_std, 3),
        "wf_oos_annual_return_pct": round(100 * verdict.wf_oos_annual_return, 2)
        if np.isfinite(verdict.wf_oos_annual_return) else None,
        "benchmark_pct": list(verdict.benchmark_pct),
        "benchmark_verdict": verdict.benchmark_verdict,
        "full_period_metrics": full_run.metrics.to_dict(),
        "oos_default_metrics": oos.default_oos.metrics.to_dict(),
        "oos_tuned_params": oos.tuned_params,
        "wf": {
            "wfe": verdict_safe(wf.wfe),
            "wfe_sharpe": verdict_safe(wf.wfe_sharpe),
            "profitable_folds_frac": wf.profitable_folds_frac,
            "n_folds": wf.n_folds,
        },
        "monte_carlo": {
            "scope": mc_scope,
            "p_ruin": mc.shuffle.p_ruin,
            "p_loss_bootstrap": mc.bootstrap.p_loss,
            "shuffle_dd_p50_pct": round(100 * mc.shuffle.dd_p50, 2),
            "shuffle_dd_p95_pct": round(100 * mc.shuffle.dd_p95, 2),
            "bootstrap_ret_p5_pct": round(100 * mc.bootstrap.ret_p5, 2),
            "bootstrap_ret_p50_pct": round(100 * mc.bootstrap.ret_p50, 2),
            "bootstrap_ret_p95_pct": round(100 * mc.bootstrap.ret_p95, 2),
        },
        "noise": {
            "profitable_frac": noise.profitable_frac,
            "sharpe_median": verdict_safe(noise.sharpe_median),
            "base_sharpe": verdict_safe(noise.base_sharpe),
        },
        "detrend": {
            "residual_sharpe": verdict_safe(detrend.residual_sharpe),
            "residual_monthly_mean_pct": round(100 * detrend.residual_monthly_mean, 3),
            "drift_annual_pct": detrend.drift_annual_pct,
        },
        "sensitivity_plateau": verdict_safe(sens.plateau_score),
        "data": summary_data,
        "seed": cfg.seed,
    }
    summary_path = out_dir / f"summary_{stamp}.json"
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False),
                            encoding="utf-8")

    log.info("Rapport : %s", report_path)
    log.info("Résumé  : %s", summary_path)
    log.info("VERDICT : %s (%d/%d contrôles) — %.1f min",
             verdict.label, verdict.n_passed, verdict.n_total, (time.time() - t0) / 60)
    log.info("Rendement mensuel OOS mesuré : %+.2f %% ± %.2f %%",
             100 * verdict.oos_monthly_mean, 100 * verdict.oos_monthly_std)
    return 0


def verdict_safe(x: float) -> float | None:
    return float(x) if np.isfinite(x) else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="goldsilver",
        description="Backtest & validation anti-overfitting XAU/USD + XAG/USD",
    )
    parser.add_argument("-c", "--config", default="config/default.yaml",
                        help="chemin du YAML de configuration")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("fetch", help="télécharge les données (Dukascopy, bid+ask)")
    sub.add_parser("backtest", help="backtest simple avec les paramètres par défaut")
    sub.add_parser("validate", help="suite de validation complète + rapport HTML")

    args = parser.parse_args(argv)
    _setup_logging(args.verbose)
    cfg = load_config(args.config)
    return {"fetch": cmd_fetch, "backtest": cmd_backtest, "validate": cmd_validate}[
        args.command
    ](cfg)


if __name__ == "__main__":
    raise SystemExit(main())
