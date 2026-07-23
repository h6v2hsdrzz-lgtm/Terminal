"""Démonstration demandée : « optimiser tous les paramètres pour le rendement max ».

Pour chaque stratégie, deux exercices sur les MÊMES grilles larges :

A. LE MIRAGE — grid-search du rendement total sur TOUT l'historique.
   C'est le chiffre qu'affiche n'importe quel optimiseur : il a vu toutes
   les données, il est mécaniquement magnifique et non reproductible.

B. LA RÉALITÉ — exactement le même optimiseur, mais borné aux premiers 70 %
   de l'historique ; les paramètres gagnants sont ensuite FIGÉS et évalués
   sur les 30 % restants (jamais vus). C'est ce que le processus
   « je choisis les paramètres au rendement max » aurait réellement produit.

Sortie : tableau console + JSON dans reports/max_return_demo.json.
"""

from __future__ import annotations

import itertools
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from goldsilver.config import Config, load_config  # noqa: E402
from goldsilver.data.loader import load_market  # noqa: E402
from goldsilver.pipeline import run_backtest, slice_market  # noqa: E402
from goldsilver.validation.oos import split_time  # noqa: E402

log = logging.getLogger("max_return_demo")

# Grilles LARGES (l'utilisateur a demandé le max : on balaie large, y compris
# le R:R). Construites depuis les ranges de sensibilité de chaque config.
GRID_PARAMS: dict[str, list[str]] = {
    "trend_pullback": ["trend_ema", "rsi_buy", "sl_atr_mult", "tp_rr"],
    "ratio_reversion": ["z_window", "z_entry", "sl_atr_mult", "tp_rr"],
    "daily_breakout": ["donchian_n", "trend_ema", "sl_atr_mult", "tp_rr"],
}


def _grid_for(cfg: Config) -> dict[str, list[Any]]:
    names = GRID_PARAMS[cfg.strategy.name]
    ranges = cfg.validation.sensitivity.ranges
    missing = [n for n in names if n not in ranges]
    if missing:
        raise KeyError(f"ranges manquants pour {missing}")
    out: dict[str, list[Any]] = {}
    for n in names:
        ref = cfg.strategy.params.get(n)
        vals = ranges[n]
        out[n] = [int(v) if isinstance(ref, int) and not isinstance(ref, bool) else float(v)
                  for v in vals]
    return out


def _search(market: dict[str, pd.DataFrame], cfg: Config, grid: dict[str, list[Any]],
            min_trades: int, no_trade_before=None) -> tuple[dict[str, Any], dict[str, float], int]:
    names = list(grid)
    best: tuple[float, dict[str, Any], dict[str, float]] | None = None
    n_runs = 0
    for values in itertools.product(*(grid[n] for n in names)):
        override = dict(zip(names, values))
        rr = run_backtest(market, cfg, override, no_trade_before)
        n_runs += 1
        m = rr.metrics
        if m.n_trades < min_trades:
            continue
        key = m.total_return
        if best is None or key > best[0]:
            best = (key, override, {
                "total_return": m.total_return,
                "monthly_mean": m.monthly_mean,
                "monthly_std": m.monthly_std,
                "sharpe": m.sharpe,
                "max_drawdown": m.max_drawdown,
                "n_trades": m.n_trades,
                "profit_factor": m.profit_factor,
            })
    if best is None:
        return {}, {}, n_runs
    return best[1], best[2], n_runs


def run_demo(config_path: str) -> dict[str, Any]:
    cfg = load_config(config_path)
    market = load_market(cfg)
    grid = _grid_for(cfg)
    n_combos = 1
    for v in grid.values():
        n_combos *= len(v)
    log.info("%s : grille %s = %d combinaisons", cfg.strategy.name,
             {k: len(v) for k, v in grid.items()}, n_combos)

    t0 = time.time()
    # A — le mirage : optimisation du rendement sur TOUT l'historique
    best_all, m_all, _ = _search(market, cfg, grid, cfg.validation.min_trades)

    # B — la réalité : même optimiseur sur 70 %, paramètres figés sur les 30 %
    t_split = split_time(market, cfg.validation.oos.train_frac)
    warmup = pd.Timedelta(days=cfg.data.warmup_days)
    train = slice_market(market, None, t_split)
    test = slice_market(market, t_split, None, warmup=warmup)
    best_train, m_train, _ = _search(train, cfg, grid, cfg.validation.min_trades)
    if best_train:
        rr_oos = run_backtest(test, cfg, best_train, no_trade_before=t_split)
        mo = rr_oos.metrics
        m_oos = {
            "total_return": mo.total_return,
            "monthly_mean": mo.monthly_mean,
            "monthly_std": mo.monthly_std,
            "sharpe": mo.sharpe,
            "max_drawdown": mo.max_drawdown,
            "n_trades": mo.n_trades,
            "profit_factor": mo.profit_factor,
        }
    else:
        m_oos = {}

    log.info("%s : %d combos x 2 recherches en %.1f min", cfg.strategy.name,
             n_combos, (time.time() - t0) / 60)
    return {
        "strategy": cfg.strategy.name,
        "config": str(config_path),
        "grid_sizes": {k: len(v) for k, v in grid.items()},
        "n_combos": n_combos,
        "mirage_full_sample": {"params": best_all, "metrics": m_all},
        "honest_process": {
            "split": str(t_split),
            "params_from_train": best_train,
            "train_metrics": m_train,
            "oos_metrics": m_oos,
        },
    }


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                        datefmt="%H:%M:%S", stream=sys.stdout)
    configs = sys.argv[1:] or ["config/default.yaml", "config/ratio.yaml",
                               "config/daily.yaml"]
    results = [run_demo(c) for c in configs]
    out = Path("reports/max_return_demo.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\n=== OPTIMISATION AU RENDEMENT MAX : mirage vs réalité ===")
    for r in results:
        a = r["mirage_full_sample"]["metrics"]
        o = r["honest_process"]["oos_metrics"]
        print(f"\n{r['strategy']} ({r['n_combos']} combos)")
        if a:
            print(f"  A. optimisé sur TOUT   : {100*a['total_return']:+8.1f} % "
                  f"({100*a['monthly_mean']:+.2f} %/mois, DD {100*a['max_drawdown']:.0f} %, "
                  f"{a['n_trades']} trades)  params={r['mirage_full_sample']['params']}")
        if o:
            t = r["honest_process"]["train_metrics"]
            print(f"  B. optimisé sur 70 %   : train {100*t['total_return']:+8.1f} % "
                  f"-> OOS {100*o['total_return']:+.1f} % "
                  f"({100*o['monthly_mean']:+.2f} %/mois, DD {100*o['max_drawdown']:.0f} %, "
                  f"{o['n_trades']} trades)  params={r['honest_process']['params_from_train']}")
    print(f"\nJSON : {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
