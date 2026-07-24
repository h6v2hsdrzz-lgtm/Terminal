"""Décorrélation + effet portefeuille : métaux seuls vs 5 actifs, à 2 % et 4 %.

1. Matrice de corrélation des rendements journaliers (confirme la décorrélation).
2. Même stratégie validée (breakout 4h) sur : métaux seuls / actifs non-métaux /
   portefeuille complet, à 2 % et 4 % de risque par trade.
3. Métriques clés dont l'efficience rendement/drawdown — c'est là que la
   décorrélation doit payer : plus de rendement pour un drawdown contenu.

Sortie : tableau console + reports/portfolio_analysis.json
"""

from __future__ import annotations

import copy
import json
import logging
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from goldsilver.config import load_config  # noqa: E402
from goldsilver.data.loader import load_market  # noqa: E402
from goldsilver.pipeline import run_backtest  # noqa: E402

logging.disable(logging.WARNING)

UNIVERSES = {
    "métaux (or+argent)": ["XAUUSD", "XAGUSD"],
    "non-métaux (SPX+WTI+BTC)": ["USA500IDXUSD", "LIGHTCMDUSD", "BTCUSD"],
    "portefeuille complet (5)": ["XAUUSD", "XAGUSD", "USA500IDXUSD", "LIGHTCMDUSD", "BTCUSD"],
}
RISKS = [0.02, 0.04]


def _cfg(root: Path, risk: float, n_assets: int):
    raw = yaml.safe_load((root / "config" / "portfolio.yaml").read_text())
    cfg = copy.deepcopy(raw)
    cfg["engine"]["risk_pct"] = risk
    cfg["engine"]["max_open_risk_pct"] = round(risk * n_assets, 4)  # tous ouvrables
    for a in cfg["data"]["assets"].values():
        a["csv"] = str(root / a["csv"])
    d = Path(tempfile.mkdtemp()) / "config"
    d.mkdir()
    p = d / "c.yaml"
    p.write_text(yaml.safe_dump(cfg))
    return load_config(p)


def main() -> int:
    root = Path.cwd()
    full_market = load_market(_cfg(root, 0.02, 5))
    names = list(full_market)

    # 1. corrélations des rendements journaliers
    closes = {}
    for a, df in full_market.items():
        daily = df["close"].resample("1D").last().dropna()
        closes[a] = daily.pct_change()
    ret = pd.DataFrame(closes).dropna()
    corr = ret.corr()
    print("=== Corrélation des rendements journaliers (2019-2026) ===")
    print(corr.round(2).to_string())
    print()

    results: dict[str, Any] = {"correlation": corr.round(3).to_dict()}
    rows = []
    for uname, assets in UNIVERSES.items():
        for risk in RISKS:
            cfg = _cfg(root, risk, len(assets))
            market = {a: full_market[a] for a in assets}
            rr = run_backtest(market, cfg)
            m = rr.metrics
            eff = m.total_return / m.max_drawdown if m.max_drawdown > 0 else float("nan")
            rows.append({
                "universe": uname, "n_assets": len(assets), "risk_pct": risk,
                "monthly_mean_pct": round(100 * m.monthly_mean, 2),
                "monthly_std_pct": round(100 * m.monthly_std, 2),
                "sharpe": round(m.sharpe, 2),
                "total_return_pct": round(100 * m.total_return, 0),
                "max_dd_pct": round(100 * m.max_drawdown, 1),
                "return_dd_ratio": round(eff, 2),
                "n_trades": m.n_trades,
                "win_rate_pct": round(100 * m.win_rate, 0),
            })
    results["backtests"] = rows

    print(f"{'univers':<28}{'risque':>7}{'%/mois':>8}{'Sharpe':>8}"
          f"{'tot%':>7}{'maxDD':>7}{'ret/DD':>7}{'trades':>7}")
    print("-" * 79)
    for r in rows:
        print(f"{r['universe']:<28}{100*r['risk_pct']:>6.0f}%{r['monthly_mean_pct']:>7.2f}%"
              f"{r['sharpe']:>8.2f}{r['total_return_pct']:>7.0f}{r['max_dd_pct']:>6.1f}%"
              f"{r['return_dd_ratio']:>7.2f}{r['n_trades']:>7}")

    out = Path("reports/portfolio_analysis.json")
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nJSON : {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
