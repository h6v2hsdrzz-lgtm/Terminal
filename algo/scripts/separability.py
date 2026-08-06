"""Les trades perdants sont-ils reconnaissables AU MOMENT DE L'ENTRÉE ?

C'est la question qui décide de tout : un filtre ne peut supprimer les
perdants que s'ils se distinguent des gagnants avec l'information disponible
avant d'entrer. On mesure donc, pour chaque caractéristique observable à
l'entrée, la capacité à discriminer gagnants et perdants — via l'AUC :

    AUC = 0.50  ->  aucune information (pile ou face)
    AUC = 0.60  ->  faible mais exploitable
    AUC >= 0.70 ->  vraie séparation

L'AUC est calculée par la statistique de Mann-Whitney (rang moyen), sans
dépendance externe. On rapporte aussi l'intervalle attendu sous l'hypothèse
« aucune information », pour distinguer un signal réel d'un bruit
d'échantillonnage.

    python scripts/separability.py
"""

from __future__ import annotations

import logging
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# à lancer depuis algo/ ; on rend l'import de filter_lab indépendant du cwd
sys.path.insert(0, str(Path(__file__).resolve().parent))

from goldsilver.config import load_config
from goldsilver.data.loader import load_market
from goldsilver.data.timeframes import build_timeframes
from goldsilver.engine.backtester import Backtester
from goldsilver.strategy.base import get_strategy

from filter_lab import CONFIG, LIVE_CONFIG, features  # même définition des features

log = logging.getLogger("separability")


def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    """AUC via les rangs (Mann-Whitney), robuste aux ex aequo."""
    if not len(pos) or not len(neg):
        return float("nan")
    allv = np.concatenate([pos, neg])
    ranks = pd.Series(allv).rank().to_numpy()
    r_pos = ranks[: len(pos)].sum()
    return float((r_pos - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


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
    tfs = {a: build_timeframes(b, cfg.data.base_timeframe, cfg.data.timeframes,
                               cfg.data.session_day_offset_hours)
           for a, b in market.items()}
    strategy = get_strategy(cfg.strategy.name, cfg.strategy.params)
    signals = strategy.generate_all(tfs)
    feats = {a: features(signals[a].index, tfs[a], dict(cfg.strategy.params))
             for a in signals}

    bt = Backtester(cfg)
    res = bt.run(signals, max_bars_held=int(cfg.strategy.params["max_bars_held"]))
    trades = res.trades_frame
    log.info("%d trades à analyser", len(trades))

    # valeur de chaque caractéristique à la bougie d'entrée du trade
    names = list(next(iter(feats.values())).keys())
    rows: list[dict[str, Any]] = []
    for t in trades.itertuples(index=False):
        f = feats[t.asset]
        ts = pd.Timestamp(t.entry_time)
        rec: dict[str, Any] = {"win": 1 if t.pnl > 0 else 0, "r": float(t.r_multiple)}
        for n in names:
            s = f[n]
            idx = s.index.searchsorted(ts, side="right") - 1
            rec[n] = float(s.iloc[idx]) if 0 <= idx < len(s) else np.nan
        rows.append(rec)

    df = pd.DataFrame(rows)
    win = df[df["win"] == 1]
    lose = df[df["win"] == 0]
    n_w, n_l = len(win), len(lose)
    # écart-type de l'AUC sous H0 (aucune information) — approximation usuelle
    sd = np.sqrt((n_w + n_l + 1) / (12.0 * n_w * n_l))

    print("\n" + "=" * 92)
    print(f"SÉPARABILITÉ GAGNANTS / PERDANTS À L'ENTRÉE  "
          f"({n_w} gagnants vs {n_l} perdants)")
    print(f"AUC 0,50 = aucune information. Bruit attendu : ±{2 * sd:.3f} (2 écarts-types)")
    print("-" * 92)
    print(f"{'caractéristique':<22} | {'AUC':>6} | {'médiane gagnants':>17} | "
          f"{'médiane perdants':>17} | verdict")
    print("-" * 92)
    out = []
    for n in names:
        a = auc(win[n].dropna().to_numpy(), lose[n].dropna().to_numpy())
        out.append((abs(a - 0.5), n, a))
    for _, n, a in sorted(out, reverse=True):
        mw, ml = win[n].median(), lose[n].median()
        signif = abs(a - 0.5) > 2 * sd
        verdict = "significatif" if signif else "indiscernable"
        print(f"{n:<22} | {a:>6.3f} | {mw:>17.3f} | {ml:>17.3f} | {verdict}")
    print("-" * 92)
    best = max(out)[2]
    print(f"Meilleure séparation obtenue : AUC {best:.3f}. "
          f"Un filtre utile exigerait ~0,70.")
    print("=" * 92)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
