"""Le taux de réussite se pilote par le rapport TP/SL — mais à quel prix ?

Le taux de réussite n'est pas une qualité en soi : il est presque entièrement
déterminé par la distance du take-profit. Un TP à 1R se touche bien plus
souvent qu'un TP à 3R, mais rapporte trois fois moins quand il se touche.
Ce script mesure l'arbitrage au lieu de le supposer, avec la même discipline
train/test que le reste du dépôt.

Rappel du seuil de rentabilité : avec un TP à ``k`` R, il faut gagner plus de
1/(1+k) des trades pour être à l'équilibre — 50 % à 1R, 25 % à 3R. Un taux de
réussite élevé obtenu en baissant le TP ne crée aucune valeur en soi.

    python scripts/rr_sweep.py
"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from goldsilver.config import load_config
from goldsilver.data.loader import load_market
from goldsilver.data.timeframes import build_timeframes
from goldsilver.engine.backtester import Backtester
from goldsilver.metrics.performance import compute_metrics
from goldsilver.strategy.base import get_strategy

log = logging.getLogger("rr_sweep")

CONFIG = "config/breakout_4h.yaml"
LIVE_CONFIG = "config/live.yaml"
SPLIT = pd.Timestamp("2024-01-01", tz="UTC")
OUT = Path("reports/rr_sweep.json")

SL_MULTS = [1.5, 2.0, 2.5, 3.0]
TP_RRS = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]


def evaluate(cfg: Any, market: dict[str, pd.DataFrame], params: dict[str, Any],
             start: pd.Timestamp | None, end: pd.Timestamp | None) -> dict[str, Any]:
    tfs = {a: build_timeframes(b, cfg.data.base_timeframe, cfg.data.timeframes,
                               cfg.data.session_day_offset_hours)
           for a, b in market.items()}
    strategy = get_strategy(cfg.strategy.name, params)
    signals = strategy.generate_all(tfs)
    sub = {}
    for a, df in signals.items():
        s = df
        if start is not None:
            s = s[s.index >= start]
        if end is not None:
            s = s[s.index < end]
        sub[a] = s
    bt = Backtester(cfg)
    res = bt.run(sub, max_bars_held=int(params["max_bars_held"]))
    if res.equity.empty or not res.trades:
        return {"n_trades": 0}
    m = compute_metrics(res.equity, res.trades_frame, res.initial_equity, res.exposure)
    return {
        "n_trades": int(m.n_trades),
        "win_rate": float(m.win_rate),
        "expectancy_r": float(m.expectancy_r),
        "profit_factor": float(m.profit_factor) if np.isfinite(m.profit_factor) else None,
        "total_return": float(m.total_return),
        "monthly_mean": float(m.monthly_mean),
        "max_drawdown": float(m.max_drawdown),
        "sharpe": float(m.sharpe),
    }


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
    cfg = load_config(CONFIG)

    from goldsilver.live.config import load_live_config
    from goldsilver.live.risk import HARD_MAX_RISK_PCT
    live = load_live_config(LIVE_CONFIG)
    cfg = replace(cfg, engine=replace(
        cfg.engine, risk_pct=min(live.risk.risk_pct, HARD_MAX_RISK_PCT),
        max_open_risk_pct=live.risk.max_open_risk_pct))

    market = load_market(cfg)
    rows: list[dict[str, Any]] = []
    total = len(SL_MULTS) * len(TP_RRS)
    i = 0
    for sl in SL_MULTS:
        for tp in TP_RRS:
            i += 1
            p = dict(cfg.strategy.params)
            p["sl_atr_mult"] = sl
            p["tp_rr"] = tp
            rows.append({
                "sl_atr_mult": sl, "tp_rr": tp,
                "train": evaluate(cfg, market, p, None, SPLIT),
                "test": evaluate(cfg, market, p, SPLIT, None),
                "full": evaluate(cfg, market, p, None, None),
            })
            log.info("  %d/%d  SL %.1f×ATR / TP %.1fR", i, total, sl, tp)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=1, default=str), encoding="utf-8")

    print("\n" + "=" * 100)
    print("ARBITRAGE TAUX DE RÉUSSITE / GAIN PAR TRADE  (SL fixé à 2,5×ATR — la valeur en production)")
    print(f"{'TP':>5} | {'seuil équilibre':>15} | {'réussite train':>14} | {'réussite test':>13} | "
          f"{'espérance test':>14} | {'total test':>10} | {'DD test':>8}")
    print("-" * 100)
    for r in [r for r in rows if r["sl_atr_mult"] == 2.5]:
        tr, te = r["train"], r["test"]
        if not te.get("n_trades"):
            continue
        breakeven = 1.0 / (1.0 + r["tp_rr"])
        print(f"{r['tp_rr']:>4.1f}R | {100 * breakeven:>14.1f} % | "
              f"{100 * tr['win_rate']:>13.1f} % | {100 * te['win_rate']:>12.1f} % | "
              f"{te['expectancy_r']:>+13.3f} R | {100 * te['total_return']:>+9.1f} % | "
              f"{100 * te['max_drawdown']:>7.1f} %")

    print("\n" + "=" * 100)
    print("MEILLEURES COMBINAISONS — choisies sur le TRAIN, jugées sur le TEST")
    ok = [r for r in rows if r["train"].get("n_trades", 0) >= 40]
    for crit, label in (("expectancy_r", "espérance R"), ("total_return", "rendement"),
                        ("win_rate", "taux de réussite")):
        best = max(ok, key=lambda r: r["train"][crit])
        tr, te = best["train"], best["test"]
        prod = [r for r in rows if r["sl_atr_mult"] == 2.5 and r["tp_rr"] == 3.0][0]
        print(f"\n  Choisi sur le train pour maximiser {label} : "
              f"SL {best['sl_atr_mult']}×ATR / TP {best['tp_rr']}R")
        print(f"    train : réussite {100 * tr['win_rate']:.1f} % · espérance "
              f"{tr['expectancy_r']:+.3f} R · total {100 * tr['total_return']:+.1f} %")
        print(f"    TEST  : réussite {100 * te['win_rate']:.1f} % · espérance "
              f"{te['expectancy_r']:+.3f} R · total {100 * te['total_return']:+.1f} % "
              f"· DD {100 * te['max_drawdown']:.1f} %")
        print(f"    production (2.5/3.0) sur le TEST : réussite "
              f"{100 * prod['test']['win_rate']:.1f} % · espérance "
              f"{prod['test']['expectancy_r']:+.3f} R · total "
              f"{100 * prod['test']['total_return']:+.1f} %")
    print("=" * 100)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
