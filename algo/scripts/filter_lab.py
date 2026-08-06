"""Peut-on supprimer des trades PERDANTS sans supprimer les GAGNANTS ?

Protocole honnête (c'est tout l'enjeu ; supprimer a posteriori des perdants
déjà connus est du sur-ajustement pur et donnerait n'importe quel résultat) :

1. Un filtre n'est admissible que s'il est calculable AVANT l'entrée, à
   partir de bougies TERMINÉES. Toutes les séries passent par
   ``align_to_base(..., shift=1)`` — aucun regard sur le futur.
2. Le filtre est CHOISI sur la période d'entraînement uniquement, puis
   ÉVALUÉ sur une période de test jamais utilisée pour choisir.
3. On rapporte aussi le « mirage » : le meilleur filtre sur l'échantillon
   complet, pour montrer l'écart entre ce qu'on croit gagner et ce qui reste.
4. La stratégie n'est PAS modifiée : on ne fait qu'annuler certains signaux.
   Mêmes entrées restantes, mêmes SL/TP, mêmes dates.

Critère de sélection : espérance en R (invariante au niveau de risque), avec
un nombre minimum de trades pour éviter les filtres qui "gagnent" en ne
prenant plus que trois trades.

    python scripts/filter_lab.py
"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from goldsilver.config import load_config
from goldsilver.data.loader import load_market
from goldsilver.data.timeframes import align_to_base, build_timeframes
from goldsilver.engine.backtester import Backtester
from goldsilver.metrics.performance import compute_metrics
from goldsilver.strategy.base import get_strategy
from goldsilver.strategy.indicators import atr, ema, rsi

log = logging.getLogger("filter_lab")

CONFIG = "config/breakout_4h.yaml"
LIVE_CONFIG = "config/live.yaml"
SPLIT = pd.Timestamp("2024-01-01", tz="UTC")   # train < SPLIT <= test
MIN_TRADES_TRAIN = 40                          # sous ce seuil, aucun crédit
OUT = Path("reports/filter_lab.json")


# --------------------------------------------------------------------- socle

def build_signals(cfg: Any) -> tuple[dict[str, pd.DataFrame], dict[str, dict[str, pd.DataFrame]]]:
    market = load_market(cfg)
    tfs_by_asset = {
        a: build_timeframes(base, cfg.data.base_timeframe, cfg.data.timeframes,
                            cfg.data.session_day_offset_hours)
        for a, base in market.items()
    }
    strategy = get_strategy(cfg.strategy.name, cfg.strategy.params)
    return strategy.generate_all(tfs_by_asset), tfs_by_asset


def features(base_index: pd.DatetimeIndex, tfs: dict[str, pd.DataFrame],
             params: dict[str, Any]) -> dict[str, pd.Series]:
    """Séries de décision, toutes projetées sans look-ahead (shift=1).

    Chacune répond à une question qu'un trader se poserait AVANT d'entrer :
    le mouvement est-il directionnel ? la cassure est-elle franche ? le prix
    est-il déjà trop étiré ? la volatilité est-elle anormale ?
    """
    tf = str(params.get("trend_timeframe", "4h"))
    f = tfs[tf]
    c, h, l = f["close"], f["high"], f["low"]
    n = int(params["donchian_n"])
    a = atr(f, int(params["atr_period"]))
    e = ema(c, int(params["trend_ema"]))

    # Efficiency Ratio de Kaufman : part de progrès net dans le chemin parcouru
    def er(window: int) -> pd.Series:
        net = (c - c.shift(window)).abs()
        path = c.diff().abs().rolling(window).sum()
        return net / path.replace(0.0, np.nan)

    upper = h.rolling(n, min_periods=n).max()
    lower = l.rolling(n, min_periods=n).min()

    raw: dict[str, pd.Series] = {
        "er60": er(60),
        "er30": er(30),
        # pente de l'EMA de tendance, en % sur 30 bougies
        "ema_slope": e / e.shift(30) - 1.0,
        # étirement : distance prix / EMA, en ATR (entrée trop tardive ?)
        "stretch_atr": (c - e) / a,
        # franchise de la cassure : dépassement du plus-haut, en ATR
        "break_atr": (c - upper.shift(1)) / a,
        # largeur du canal en ATR : étroit = compression, large = chop
        "chan_atr": (upper - lower) / a,
        # volatilité relative : ATR courant vs sa médiane longue
        "atr_ratio": a / a.rolling(200, min_periods=50).median(),
        "rsi14": rsi(c, 14),
    }
    out = {k: align_to_base(base_index, v, shift=1) for k, v in raw.items()}

    # confirmation du timeframe supérieur (daily) si disponible
    if "1d" in tfs:
        d = tfs["1d"]
        ed = ema(d["close"], 50)
        out["daily_above_ema"] = align_to_base(base_index, (d["close"] > ed).astype(float), shift=1)
    return out


# ------------------------------------------------------------------- filtres

#: (nom lisible, fonction masque). Un masque True = signal CONSERVÉ.
FilterFn = Callable[[dict[str, pd.Series]], pd.Series]


def candidate_filters() -> list[tuple[str, FilterFn]]:
    out: list[tuple[str, FilterFn]] = []

    # 1) le filtre de régime DÉJÀ appliqué par le bot live (mais pas par le
    #    backtest) : sa mesure est directement actionnable
    for thr in (0.10, 0.15, 0.20, 0.25, 0.30):
        out.append((f"regime_live_ER>={thr:.2f}",
                    lambda f, t=thr: (f["er60"] >= t) & (f["ema_slope"] >= 0.0)))
    for thr in (0.15, 0.20, 0.25, 0.30, 0.35):
        out.append((f"ER60>={thr:.2f}", lambda f, t=thr: f["er60"] >= t))
    for thr in (0.20, 0.30, 0.40):
        out.append((f"ER30>={thr:.2f}", lambda f, t=thr: f["er30"] >= t))

    # 2) pente de tendance minimale
    for thr in (0.0, 0.005, 0.01, 0.02):
        out.append((f"pente>={thr:.3f}", lambda f, t=thr: f["ema_slope"] >= t))

    # 3) ne pas acheter un prix déjà trop étiré au-dessus de l'EMA
    for thr in (1.5, 2.0, 3.0, 4.0, 6.0):
        out.append((f"etirement<={thr}ATR", lambda f, t=thr: f["stretch_atr"] <= t))

    # 4) exiger une cassure franche (ou au contraire tolérer les frôlements)
    for thr in (0.0, 0.05, 0.10, 0.25, 0.50):
        out.append((f"cassure>={thr}ATR", lambda f, t=thr: f["break_atr"] >= t))

    # 5) largeur du canal : compression vs chop
    for thr in (6.0, 8.0, 10.0, 14.0):
        out.append((f"canal<={thr}ATR", lambda f, t=thr: f["chan_atr"] <= t))
    for thr in (3.0, 4.0, 5.0):
        out.append((f"canal>={thr}ATR", lambda f, t=thr: f["chan_atr"] >= t))

    # 6) régime de volatilité
    for thr in (1.2, 1.5, 2.0):
        out.append((f"ATR<={thr}x median", lambda f, t=thr: f["atr_ratio"] <= t))
    for thr in (0.7, 0.8, 0.9):
        out.append((f"ATR>={thr}x median", lambda f, t=thr: f["atr_ratio"] >= t))

    # 7) surachat
    for thr in (70.0, 80.0, 90.0):
        out.append((f"RSI<={thr:.0f}", lambda f, t=thr: f["rsi14"] <= t))

    # 8) confirmation daily
    out.append(("daily>EMA50", lambda f: f.get("daily_above_ema", pd.Series(dtype=float)) > 0.5))

    # 9) combinaisons plausibles (régime + qualité de cassure)
    out.append(("ER60>=0.20 & cassure>=0.10ATR",
                lambda f: (f["er60"] >= 0.20) & (f["break_atr"] >= 0.10)))
    out.append(("ER60>=0.20 & etirement<=3ATR",
                lambda f: (f["er60"] >= 0.20) & (f["stretch_atr"] <= 3.0)))
    out.append(("ER60>=0.25 & pente>=0.01",
                lambda f: (f["er60"] >= 0.25) & (f["ema_slope"] >= 0.01)))
    out.append(("etirement<=3ATR & canal<=10ATR",
                lambda f: (f["stretch_atr"] <= 3.0) & (f["chan_atr"] <= 10.0)))
    return out


# ------------------------------------------------------------------ backtest

def run(cfg: Any, signals: dict[str, pd.DataFrame],
        start: pd.Timestamp | None, end: pd.Timestamp | None) -> dict[str, Any]:
    sub = {}
    for a, df in signals.items():
        s = df
        if start is not None:
            s = s[s.index >= start]
        if end is not None:
            s = s[s.index < end]
        sub[a] = s
    max_bars = cfg.strategy.params.get("max_bars_held")
    bt = Backtester(cfg)
    res = bt.run(sub, max_bars_held=int(max_bars) if max_bars else None)
    if res.equity.empty:
        return {"n_trades": 0}
    m = compute_metrics(res.equity, res.trades_frame, res.initial_equity, res.exposure)
    t = res.trades_frame
    return {
        "n_trades": int(m.n_trades),
        "win_rate": float(m.win_rate),
        "expectancy_r": float(m.expectancy_r),
        "profit_factor": float(m.profit_factor) if np.isfinite(m.profit_factor) else None,
        "total_return": float(m.total_return),
        "monthly_mean": float(m.monthly_mean),
        "max_drawdown": float(m.max_drawdown),
        "sharpe": float(m.sharpe),
        "n_losers": int((t["pnl"] <= 0).sum()) if len(t) else 0,
        "n_winners": int((t["pnl"] > 0).sum()) if len(t) else 0,
        "sum_r": float(t["r_multiple"].sum()) if len(t) else 0.0,
    }


def apply_filter(signals: dict[str, pd.DataFrame],
                 feats: dict[str, dict[str, pd.Series]],
                 fn: FilterFn) -> dict[str, pd.DataFrame]:
    out = {}
    for a, df in signals.items():
        mask = fn(feats[a])
        keep = mask.reindex(df.index).fillna(False).to_numpy().astype(bool)
        d = df.copy()
        d["signal"] = np.where(keep, d["signal"].to_numpy(), 0)
        out[a] = d
    return out


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
    cfg = load_config(CONFIG)

    # même niveau de risque que le bot, pour que return/DD soient lisibles
    from goldsilver.live.config import load_live_config
    from goldsilver.live.risk import HARD_MAX_RISK_PCT
    live = load_live_config(LIVE_CONFIG)
    cfg = replace(cfg, engine=replace(
        cfg.engine, risk_pct=min(live.risk.risk_pct, HARD_MAX_RISK_PCT),
        max_open_risk_pct=live.risk.max_open_risk_pct))

    log.info("Génération des signaux de référence…")
    signals, tfs_by_asset = build_signals(cfg)
    feats = {a: features(signals[a].index, tfs_by_asset[a], dict(cfg.strategy.params))
             for a in signals}

    base = {
        "full": run(cfg, signals, None, None),
        "train": run(cfg, signals, None, SPLIT),
        "test": run(cfg, signals, SPLIT, None),
    }
    log.info("Référence  train : %d trades, réussite %.1f %%, espérance %.3f R",
             base["train"]["n_trades"], 100 * base["train"]["win_rate"],
             base["train"]["expectancy_r"])
    log.info("Référence  test  : %d trades, réussite %.1f %%, espérance %.3f R",
             base["test"]["n_trades"], 100 * base["test"]["win_rate"],
             base["test"]["expectancy_r"])

    rows: list[dict[str, Any]] = []
    cands = candidate_filters()
    log.info("Évaluation de %d filtres…", len(cands))
    for i, (name, fn) in enumerate(cands, 1):
        try:
            filtered = apply_filter(signals, feats, fn)
        except Exception as exc:  # noqa: BLE001
            log.warning("  %s : ignoré (%s)", name, exc)
            continue
        row = {
            "name": name,
            "train": run(cfg, filtered, None, SPLIT),
            "test": run(cfg, filtered, SPLIT, None),
            "full": run(cfg, filtered, None, None),
        }
        rows.append(row)
        if i % 10 == 0:
            log.info("  %d/%d…", i, len(cands))

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"baseline": base, "filters": rows,
                               "split": str(SPLIT), "risk_pct": cfg.engine.risk_pct},
                              indent=1, default=str), encoding="utf-8")
    log.info("Résultats écrits : %s", OUT)

    # ---- sélection HONNÊTE : sur le train seulement -------------------------
    eligible = [r for r in rows if r["train"]["n_trades"] >= MIN_TRADES_TRAIN]
    if not eligible:
        print("Aucun filtre ne garde assez de trades sur le train.")
        return 0
    best = max(eligible, key=lambda r: r["train"]["expectancy_r"])

    # ---- le mirage : meilleur sur l'échantillon complet ---------------------
    mirage = max([r for r in rows if r["full"]["n_trades"] >= MIN_TRADES_TRAIN],
                 key=lambda r: r["full"]["expectancy_r"])

    def line(tag: str, m: dict[str, Any]) -> str:
        if not m.get("n_trades"):
            return f"  {tag:<10} aucun trade"
        return (f"  {tag:<10} {m['n_trades']:4d} trades · réussite "
                f"{100 * m['win_rate']:5.1f} % · espérance {m['expectancy_r']:+.3f} R"
                f" · PF {m['profit_factor'] or 0:.2f} · total {100 * m['total_return']:+7.1f} %"
                f" · DD {100 * m['max_drawdown']:5.1f} %")

    print("\n" + "=" * 78)
    print("RÉFÉRENCE (aucun filtre)")
    for k in ("train", "test", "full"):
        print(line(k, base[k]))

    print(f"\nMEILLEUR FILTRE CHOISI SUR LE TRAIN — « {best['name']} »")
    for k in ("train", "test"):
        print(line(k, best[k]))
    d_wr = 100 * (best["test"]["win_rate"] - base["test"]["win_rate"])
    d_ex = best["test"]["expectancy_r"] - base["test"]["expectancy_r"]
    print(f"  -> hors échantillon : réussite {d_wr:+.1f} pts, "
          f"espérance {d_ex:+.3f} R vs référence")

    print(f"\nLE MIRAGE (meilleur sur l'échantillon COMPLET) — « {mirage['name']} »")
    print(line("full", mirage["full"]))
    print(line("test", mirage["test"]))

    # combien de filtres battent la référence sur le test ? (hasard attendu ~50 %)
    beat = [r for r in rows
            if r["test"].get("n_trades", 0) >= 10
            and r["test"]["expectancy_r"] > base["test"]["expectancy_r"]]
    print(f"\n{len(beat)}/{len(rows)} filtres battent la référence sur le TEST "
          f"(le hasard en donnerait ~{len(rows) // 2}).")

    print("\nTOP 8 sur le TEST (à ne PAS utiliser pour choisir — juste pour voir "
          "la dispersion) :")
    for r in sorted([r for r in rows if r["test"].get("n_trades", 0) >= 10],
                    key=lambda r: -r["test"]["expectancy_r"])[:8]:
        print(f"  {r['name']:<34}" + line("", r["test"]).strip())
    print("=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
