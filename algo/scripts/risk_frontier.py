"""Frontière risque/croissance de la stratégie survivante (daily_breakout).

« Pousser les limites au max » a une réponse mesurable : pour chaque niveau
de risque par trade, on relance le VRAI moteur (minimums de lot, plafonds de
levier or x20 / argent x10, coûts) sur toute la période, puis un Monte-Carlo
bootstrap sur les trades obtenus donne la distribution des trajectoires.

La quantité qui définit « le max » est la croissance MÉDIANE : au-delà de la
fraction de Kelly, risquer plus fait BAISSER la médiane long terme (les
drawdowns composés mangent plus que les gains) pendant que P(ruine) explose.

Usage : python3 scripts/risk_frontier.py [config] — défaut config/daily.yaml
Sortie : tableau console + reports/risk_frontier.json
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import logging  # noqa: E402

from goldsilver.config import load_config  # noqa: E402
from goldsilver.data.loader import load_market  # noqa: E402
from goldsilver.pipeline import run_backtest, slice_market  # noqa: E402
from goldsilver.validation.oos import split_time  # noqa: E402

logging.disable(logging.WARNING)

# Paramètres retenus par l'optimisation SUR LE TRAIN UNIQUEMENT (voir
# scripts/optimize_max_return.py) — jamais choisis en regardant l'OOS.
PARAMS_FROM_TRAIN: dict[str, Any] = {
    "donchian_n": 30, "trend_ema": 50, "sl_atr_mult": 1.5, "tp_rr": 2.5,
}
RISK_LEVELS = [0.01, 0.02, 0.03, 0.05, 0.075, 0.10, 0.15, 0.20, 0.25, 0.30]
N_MC = 2000
SEED = 42


def _cfg_with_risk(base_config: Path, root: Path, risk: float):
    raw = yaml.safe_load(base_config.read_text())
    raw["engine"]["risk_pct"] = risk
    raw["engine"]["max_open_risk_pct"] = risk * 2
    for a in raw["data"]["assets"].values():
        a["csv"] = str(root / a["csv"])
    tmp = Path(tempfile.mkdtemp()) / "config"
    tmp.mkdir()
    p = tmp / "cfg.yaml"
    p.write_text(yaml.safe_dump(raw))
    return load_config(p)


def _mc_paths(pnl_pct: np.ndarray, n_runs: int, rng: np.random.Generator) -> dict[str, float]:
    n = len(pnl_pct)
    picks = rng.integers(0, n, size=(n_runs, n))
    r = pnl_pct[picks]
    equity = np.cumprod(1.0 + r, axis=1)
    peak = np.maximum.accumulate(equity, axis=1)
    dd = 1.0 - equity / peak
    return {
        "median_final_multiple": float(np.median(equity[:, -1])),
        "p5_final_multiple": float(np.percentile(equity[:, -1], 5)),
        "p_dd_30": float((dd.max(axis=1) >= 0.30).mean()),
        "p_dd_50": float((dd.max(axis=1) >= 0.50).mean()),
        "p_dd_80": float((dd.max(axis=1) >= 0.80).mean()),
    }


def main() -> int:
    base_config = Path(sys.argv[1] if len(sys.argv) > 1 else "config/daily.yaml")
    root = Path.cwd()
    rng = np.random.default_rng(SEED)

    cfg0 = _cfg_with_risk(base_config, root, 0.02)
    market = load_market(cfg0)
    t_split = split_time(market, cfg0.validation.oos.train_frac)
    test = slice_market(market, t_split, None,
                        warmup=pd.Timedelta(days=cfg0.data.warmup_days))

    rows: list[dict[str, Any]] = []
    for risk in RISK_LEVELS:
        cfg = _cfg_with_risk(base_config, root, risk)
        rr_full = run_backtest(market, cfg, PARAMS_FROM_TRAIN)
        rr_oos = run_backtest(test, cfg, PARAMS_FROM_TRAIN, no_trade_before=t_split)
        m = rr_full.metrics
        row: dict[str, Any] = {
            "risk_pct": risk,
            "full_monthly_mean": m.monthly_mean,
            "full_monthly_std": m.monthly_std,
            "full_total_return": m.total_return,
            "full_max_dd": m.max_drawdown,
            "full_n_trades": m.n_trades,
            "oos_monthly_mean": rr_oos.metrics.monthly_mean,
            "oos_max_dd": rr_oos.metrics.max_drawdown,
        }
        if m.n_trades >= 10:
            pnl = rr_full.trades["pnl_pct"].to_numpy()
            row["mc"] = _mc_paths(pnl, N_MC, rng)
            # croissance médiane annualisée du MC (mêmes ~7.5 ans de trades)
            years = m.n_days / 365.25
            row["mc_median_annual_growth"] = (
                row["mc"]["median_final_multiple"] ** (1 / years) - 1
            )
        rows.append(row)

    out = Path("reports/risk_frontier.json")
    out.write_text(json.dumps(rows, indent=2), encoding="utf-8")

    print(f"{'risque':>7} | {'%/mois':>7} | {'σ/mois':>6} | {'DD hist':>7} | "
          f"{'médiane MC /an':>14} | {'P(DD>=50%)':>10} | {'P(DD>=80%)':>10} | {'trades':>6}")
    for r in rows:
        mc = r.get("mc", {})
        g = r.get("mc_median_annual_growth")
        print(f"{100*r['risk_pct']:>6.1f}% | {100*r['full_monthly_mean']:>+6.2f}% | "
              f"{100*r['full_monthly_std']:>5.1f}% | {100*r['full_max_dd']:>6.1f}% | "
              f"{('%+13.1f%%' % (100*g)) if g is not None else 'n/a':>14} | "
              f"{100*mc.get('p_dd_50', float('nan')):>9.1f}% | "
              f"{100*mc.get('p_dd_80', float('nan')):>9.1f}% | {r['full_n_trades']:>6}")
    print(f"\nJSON : {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
