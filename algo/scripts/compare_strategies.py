"""Compare les nouvelles stratégies price-action/SMC à l'edge validé (breakout 4h).

Chaque stratégie subit la MÊME validation complète (OOS, walk-forward, noise,
detrend, sensibilité, Monte-Carlo) et reçoit le même verdict. Sortie : un
tableau comparatif + un JSON. La décision keep/revert est prise à la lumière
du scepticisme « tests multiples » : un challenger ne remplace l'incumbent que
s'il obtient AU MOINS aussi bon verdict ET un meilleur rendement mensuel OOS
avec une robustesse (walk-forward, bruit, detrend) au moins équivalente.
"""

from __future__ import annotations

import copy
import json
import logging
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from goldsilver.config import load_config  # noqa: E402
from goldsilver.data.loader import load_market  # noqa: E402
from goldsilver.pipeline import run_backtest  # noqa: E402
from goldsilver.report.verdict import build_verdict  # noqa: E402
from goldsilver.validation.detrend import run_detrend_test  # noqa: E402
from goldsilver.validation.monte_carlo import run_monte_carlo  # noqa: E402
from goldsilver.validation.noise import run_noise_test  # noqa: E402
from goldsilver.validation.oos import run_oos  # noqa: E402
from goldsilver.validation.sensitivity import run_sensitivity  # noqa: E402
from goldsilver.validation.walk_forward import run_walk_forward  # noqa: E402

logging.disable(logging.WARNING)

# strategy -> (params, grid, sensitivity pairs+ranges). Grilles PETITES (anti-overfit).
CHALLENGERS: dict[str, dict[str, Any]] = {
    "excessive_candle_reversion": {
        "params": {"timeframe": "4h", "atr_period": 14, "range_atr_mult": 2.0,
                   "sl_atr_mult": 2.0, "tp_rr": 3.0, "max_bars_held": 30,
                   "direction": "both"},
        "grid": {"range_atr_mult": [1.5, 2.0, 2.5], "sl_atr_mult": [1.5, 2.0, 2.5],
                 "tp_rr": [2.0, 3.0]},
        "pairs": [["range_atr_mult", "tp_rr"], ["sl_atr_mult", "tp_rr"]],
        "ranges": {"range_atr_mult": [1.0, 1.5, 2.0, 2.5, 3.0],
                   "sl_atr_mult": [1.0, 1.5, 2.0, 2.5, 3.0],
                   "tp_rr": [1.5, 2.0, 2.5, 3.0, 4.0]},
    },
    "gap_fill": {
        "params": {"timeframe": "4h", "atr_period": 14, "gap_atr_mult": 1.0,
                   "sl_atr_mult": 2.0, "tp_rr": 3.0, "max_bars_held": 20,
                   "direction": "both"},
        "grid": {"gap_atr_mult": [0.5, 1.0, 1.5], "sl_atr_mult": [1.5, 2.0, 2.5],
                 "tp_rr": [2.0, 3.0]},
        "pairs": [["gap_atr_mult", "tp_rr"], ["sl_atr_mult", "tp_rr"]],
        "ranges": {"gap_atr_mult": [0.5, 1.0, 1.5, 2.0, 2.5],
                   "sl_atr_mult": [1.0, 1.5, 2.0, 2.5, 3.0],
                   "tp_rr": [1.5, 2.0, 2.5, 3.0, 4.0]},
    },
    "fair_value_gap": {
        "params": {"timeframe": "4h", "atr_period": 14, "min_gap_atr": 0.25,
                   "sl_atr_mult": 2.0, "tp_rr": 3.0, "max_bars_held": 30,
                   "mode": "continuation"},
        "grid": {"min_gap_atr": [0.1, 0.25, 0.5], "sl_atr_mult": [1.5, 2.0, 2.5],
                 "tp_rr": [2.0, 3.0]},
        "pairs": [["min_gap_atr", "tp_rr"], ["sl_atr_mult", "tp_rr"]],
        "ranges": {"min_gap_atr": [0.1, 0.25, 0.5, 0.75, 1.0],
                   "sl_atr_mult": [1.0, 1.5, 2.0, 2.5, 3.0],
                   "tp_rr": [1.5, 2.0, 2.5, 3.0, 4.0]},
    },
    "liquidity_sweep": {
        "params": {"timeframe": "4h", "atr_period": 14, "swing_lookback": 20,
                   "sl_atr_mult": 2.0, "tp_rr": 3.0, "max_bars_held": 30,
                   "direction": "both"},
        "grid": {"swing_lookback": [10, 20, 40], "sl_atr_mult": [1.5, 2.0, 2.5],
                 "tp_rr": [2.0, 3.0]},
        "pairs": [["swing_lookback", "tp_rr"], ["sl_atr_mult", "tp_rr"]],
        "ranges": {"swing_lookback": [10, 20, 30, 40, 60],
                   "sl_atr_mult": [1.0, 1.5, 2.0, 2.5, 3.0],
                   "tp_rr": [1.5, 2.0, 2.5, 3.0, 4.0]},
    },
}


def _make_config(root: Path, strategy: str, spec: dict[str, Any] | None) -> Path:
    base = yaml.safe_load((root / "config" / "breakout_4h.yaml").read_text())
    cfg = copy.deepcopy(base)
    for a in cfg["data"]["assets"].values():
        a["csv"] = str(root / a["csv"])
    if spec is not None:
        cfg["strategy"] = {"name": strategy, "params": spec["params"]}
        cfg["validation"]["grid"] = spec["grid"]
        cfg["validation"]["sensitivity"] = {"metric": "sharpe", "pairs": spec["pairs"],
                                            "ranges": spec["ranges"]}
        cfg["validation"]["min_trades"] = 30
    d = Path(tempfile.mkdtemp()) / "config"
    d.mkdir()
    p = d / f"{strategy}.yaml"
    p.write_text(yaml.safe_dump(cfg))
    return p


def _validate(config_path: Path) -> dict[str, Any]:
    cfg = load_config(config_path)
    market = load_market(cfg)
    full = run_backtest(market, cfg)
    oos = run_oos(market, cfg)
    wf = run_walk_forward(market, cfg)
    mc_trades = (oos.default_oos.trades if len(oos.default_oos.trades) >= 30
                 else full.trades)
    mc = run_monte_carlo(mc_trades, cfg.validation.monte_carlo, cfg.seed)
    noise = run_noise_test(market, cfg)
    detrend = run_detrend_test(market, cfg)
    sens = run_sensitivity(market, cfg)
    verdict = build_verdict(oos, wf, mc, noise, detrend, sens, cfg.report)
    d = oos.default_oos.metrics
    return {
        "verdict": verdict.label,
        "checks_passed": verdict.n_passed,
        "core_passed": verdict.n_core_passed,
        "oos_monthly_mean_pct": round(100 * d.monthly_mean, 3),
        "oos_monthly_std_pct": round(100 * d.monthly_std, 3),
        "oos_total_return_pct": round(100 * d.total_return, 1),
        "oos_sharpe": round(d.sharpe, 3),
        "oos_max_dd_pct": round(100 * d.max_drawdown, 1),
        "oos_n_trades": d.n_trades,
        "oos_win_rate_pct": round(100 * d.win_rate, 1),
        "oos_profit_factor": round(d.profit_factor, 3) if d.profit_factor != float("inf") else None,
        "full_monthly_mean_pct": round(100 * full.metrics.monthly_mean, 3),
        "full_total_return_pct": round(100 * full.metrics.total_return, 1),
        "full_max_dd_pct": round(100 * full.metrics.max_drawdown, 1),
        "full_n_trades": full.metrics.n_trades,
        "wfe": round(wf.wfe, 3) if wf.wfe == wf.wfe else None,
        "wf_profitable_folds": round(wf.profitable_folds_frac, 2),
        "noise_profitable_frac": round(noise.profitable_frac, 2),
        "detrend_residual_sharpe": round(detrend.residual_sharpe, 3),
        "sensitivity_plateau": round(sens.plateau_score, 3) if sens.plateau_score == sens.plateau_score else None,
    }


def main() -> int:
    logging.disable(logging.CRITICAL)
    root = Path.cwd()
    results: dict[str, Any] = {}

    print("Validation de l'incumbent (breakout_4h)…", file=sys.stderr)
    t0 = time.time()
    results["breakout_4h (INCUMBENT)"] = _validate(root / "config" / "breakout_4h.yaml")

    for name, spec in CHALLENGERS.items():
        print(f"Validation de {name}…", file=sys.stderr)
        results[name] = _validate(_make_config(root, name, spec))

    print(f"\n(total {(time.time() - t0) / 60:.1f} min)\n", file=sys.stderr)

    out = Path("reports/strategy_comparison.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    cols = [
        ("verdict", "verdict", "{}"),
        ("chk", "checks_passed", "{}/7"),
        ("OOS %/mois", "oos_monthly_mean_pct", "{:+.2f}"),
        ("OOS tot%", "oos_total_return_pct", "{:+.0f}"),
        ("OOS DD%", "oos_max_dd_pct", "{:.0f}"),
        ("OOS n", "oos_n_trades", "{}"),
        ("WFE", "wfe", "{}"),
        ("noise+", "noise_profitable_frac", "{}"),
        ("detr.Sh", "detrend_residual_sharpe", "{}"),
        ("plateau", "sensitivity_plateau", "{}"),
    ]
    header = f"{'stratégie':<32} " + " ".join(f"{c[0]:>10}" for c in cols)
    print(header)
    print("-" * len(header))
    for name, r in results.items():
        cells = []
        for _, key, fmt in cols:
            v = r.get(key)
            cells.append(fmt.format(v) if isinstance(v, (int, float)) else str(v)[:10])
        print(f"{name:<32} " + " ".join(f"{c:>10}" for c in cells))
    print(f"\nJSON : {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
