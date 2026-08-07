"""Analyses avancées dérivées des trades et des bougies.

Ce module ne produit AUCUNE décision de trading : il explique après coup ce
que la stratégie a fait, pour rendre visibles des propriétés qu'une simple
courbe d'equity cache.

Les analyses fournies répondent chacune à une question opérationnelle :

- **MAE / MFE** — jusqu'où un trade est-il allé CONTRE nous avant de gagner,
  et jusqu'où est-il allé POUR nous avant de perdre ? C'est la mesure qui dit
  si le stop est trop serré (beaucoup de gagnants frôlant le stop) ou si le
  take-profit laisse de l'argent sur la table.
- **Séries** — combien de pertes consécutives faut-il être prêt à encaisser ?
  Le kill switch « 6 pertes d'affilée » se juge sur cette distribution.
- **Heure et jour d'entrée** — la stratégie dépend-elle d'une session ?
- **Espérance glissante** — l'edge se dégrade-t-il dans le temps ?
- **Projection Monte-Carlo** — en rééchantillonnant les R passés, quelle
  dispersion de résultats attendre sur les prochains trades ? Donne un cône
  honnête plutôt qu'une prévision unique.
- **Coûts** — ce que le swap et l'exécution ont réellement prélevé.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

import numpy as np

#: nombre de trades projetés par la simulation (≈ 12 mois au rythme observé)
MC_HORIZON_TRADES = 40
MC_PATHS = 4000
MC_SEED = 42


def _finite(values: Iterable[Any]) -> list[float]:
    out = []
    for v in values:
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(f):
            out.append(f)
    return out


# --------------------------------------------------------------- MAE / MFE

def excursions(trades: list[dict[str, Any]],
               candles: dict[str, list[list[Any]]]) -> dict[str, Any]:
    """Excursion adverse et favorable maximales de chaque trade, en R.

    Un trade gagnant passé par −0,9R a failli être stoppé : si beaucoup de
    gagnants sont dans ce cas, resserrer le stop détruirait la stratégie.
    """
    series: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
    for asset, rows in candles.items():
        if not rows:
            continue
        arr = np.asarray(rows, dtype=float)
        series[asset] = (arr[:, 0], arr[:, 2], arr[:, 3])   # temps, high, low

    out: list[dict[str, Any]] = []
    for t in trades:
        asset = t.get("asset")
        entry, sl = t.get("entry"), t.get("sl")
        t0, t1 = t.get("entry_time"), t.get("exit_time")
        if asset not in series or not entry or not sl or not t0 or not t1:
            continue
        risk = abs(float(entry) - float(sl))
        if risk <= 0:
            continue
        ts, hi, lo = series[asset]
        i0, i1 = np.searchsorted(ts, t0, "left"), np.searchsorted(ts, t1, "right")
        if i1 <= i0:
            continue
        side = 1 if int(t.get("side", 1)) > 0 else -1
        seg_hi, seg_lo = hi[i0:i1].max(), lo[i0:i1].min()
        if side > 0:
            mfe = (seg_hi - entry) / risk
            mae = (seg_lo - entry) / risk
        else:
            mfe = (entry - seg_lo) / risk
            mae = (entry - seg_hi) / risk
        out.append({
            "id": t.get("id"), "r": t.get("r_multiple"),
            "win": bool((t.get("r_multiple") or 0) > 0),
            "mae": round(float(min(mae, 0.0)), 3),
            "mfe": round(float(max(mfe, 0.0)), 3),
        })

    winners = [x for x in out if x["win"]]
    losers = [x for x in out if not x["win"]]
    deep = [x for x in winners if x["mae"] <= -0.5]
    near = [x for x in losers if x["mfe"] >= 1.0]
    return {
        "trades": out,
        "n": len(out),
        "median_mae_winners": round(float(np.median([x["mae"] for x in winners])), 3) if winners else None,
        "median_mfe_losers": round(float(np.median([x["mfe"] for x in losers])), 3) if losers else None,
        # part des gagnants passés à moins d'un demi-R du stop
        "winners_deep_underwater_pct": round(100 * len(deep) / len(winners), 1) if winners else None,
        "losers_were_ahead_1r_pct": round(100 * len(near) / len(losers), 1) if losers else None,
    }


# ------------------------------------------------------------------ séries

def streaks(trades: list[dict[str, Any]]) -> dict[str, Any]:
    """Distribution des séries de gains et de pertes consécutifs."""
    seq = [1 if (t.get("r_multiple") or 0) > 0 else 0
           for t in trades if t.get("r_multiple") is not None]
    runs_w: list[int] = []
    runs_l: list[int] = []
    if seq:
        cur, n = seq[0], 1
        for v in seq[1:]:
            if v == cur:
                n += 1
            else:
                (runs_w if cur else runs_l).append(n)
                cur, n = v, 1
        (runs_w if cur else runs_l).append(n)

    def hist(runs: list[int]) -> list[dict[str, int]]:
        if not runs:
            return []
        m = max(runs)
        return [{"len": k, "count": runs.count(k)} for k in range(1, m + 1) if runs.count(k)]

    return {
        "max_wins": max(runs_w) if runs_w else 0,
        "max_losses": max(runs_l) if runs_l else 0,
        "avg_losses": round(float(np.mean(runs_l)), 2) if runs_l else 0.0,
        "hist_wins": hist(runs_w),
        "hist_losses": hist(runs_l),
    }


# ------------------------------------------------------- heure et jour

def by_time(trades: list[dict[str, Any]]) -> dict[str, Any]:
    import datetime as dt

    buckets_h: dict[int, list[float]] = {}
    buckets_d: dict[int, list[float]] = {}
    for t in trades:
        r, ts = t.get("r_multiple"), t.get("entry_time")
        if r is None or not ts:
            continue
        d = dt.datetime.fromtimestamp(ts, dt.timezone.utc)
        buckets_h.setdefault(d.hour, []).append(float(r))
        buckets_d.setdefault(d.weekday(), []).append(float(r))

    def pack(b: dict[int, list[float]]) -> list[dict[str, Any]]:
        return [{"k": k, "n": len(v), "sum_r": round(float(np.sum(v)), 2),
                 "mean_r": round(float(np.mean(v)), 3),
                 "win_rate": round(float(np.mean([x > 0 for x in v])), 3)}
                for k, v in sorted(b.items())]

    return {"by_hour": pack(buckets_h), "by_weekday": pack(buckets_d)}


# ------------------------------------------------------ espérance glissante

def rolling_expectancy(trades: list[dict[str, Any]], window: int = 30) -> list[list[Any]]:
    """Moyenne mobile des R, horodatée à la sortie.

    Deux trades (or et argent) peuvent se clôturer sur la même bougie : les
    horodatages en doublon sont fusionnés en gardant la dernière valeur, car
    une série temporelle de graphique doit être strictement croissante.
    """
    rs = [(t.get("exit_time"), t.get("r_multiple")) for t in trades
          if t.get("r_multiple") is not None and t.get("exit_time")]
    rs.sort(key=lambda x: x[0])
    vals = [float(r) for _, r in rs]
    merged: dict[int, float] = {}
    for i in range(window - 1, len(vals)):
        merged[int(rs[i][0])] = round(float(np.mean(vals[i - window + 1:i + 1])), 4)
    return [[ts, v] for ts, v in sorted(merged.items())]


# ------------------------------------------------------- projection Monte-Carlo

def monte_carlo(trades: list[dict[str, Any]], risk_pct: float,
                horizon: int = MC_HORIZON_TRADES,
                paths: int = MC_PATHS) -> dict[str, Any]:
    """Rééchantillonne les R passés pour projeter les prochains trades.

    Hypothèse assumée et FAUSSE en toute rigueur : les trades sont
    indépendants et tirés de la même distribution. Le cône donne donc une
    dispersion plausible, pas une prévision — et il ignore les changements de
    régime de marché, qui sont justement le risque principal.
    """
    rs = np.asarray(_finite(t.get("r_multiple") for t in trades), dtype=float)
    if len(rs) < 20 or risk_pct <= 0:
        return {}
    rng = np.random.default_rng(MC_SEED)
    draws = rng.choice(rs, size=(paths, horizon), replace=True)
    growth = 1.0 + risk_pct * draws
    growth = np.maximum(growth, 0.01)          # une perte ne peut pas ruiner au-delà de 0
    curves = np.cumprod(growth, axis=1)

    peak = np.maximum.accumulate(curves, axis=1)
    dd = (curves / peak - 1.0).min(axis=1)
    final = curves[:, -1] - 1.0

    qs = [5, 25, 50, 75, 95]
    bands = {
        f"p{q}": [round(float(v), 4) for v in np.percentile(curves - 1.0, q, axis=0)]
        for q in qs
    }
    return {
        "horizon_trades": horizon,
        "paths": paths,
        "risk_pct": risk_pct,
        "bands": bands,
        "final_pct": {f"p{q}": round(float(np.percentile(final, q)) * 100, 2) for q in qs},
        "max_dd_pct": {f"p{q}": round(float(np.percentile(dd, 100 - q)) * 100, 2) for q in qs},
        "prob_negative": round(float((final < 0).mean()), 4),
        "prob_dd_over_20": round(float((dd <= -0.20).mean()), 4),
    }


# ------------------------------------------------------------------- coûts

def costs(trades: list[dict[str, Any]]) -> dict[str, Any]:
    swaps = _finite(t.get("swap_paid") for t in trades)
    pnls = _finite(t.get("pnl") for t in trades)
    return {
        "total_swap": round(float(np.sum(swaps)), 2) if swaps else 0.0,
        "total_pnl": round(float(np.sum(pnls)), 2) if pnls else 0.0,
        "swap_share_of_gross": (
            round(float(abs(np.sum(swaps)) / max(abs(np.sum(pnls)), 1e-9)), 4)
            if swaps and pnls else None
        ),
        "avg_bars_held": round(float(np.mean(_finite(t.get("bars_held") for t in trades))), 1)
        if trades else None,
    }


# ------------------------------------------------------- position en cours

def position_progress(position: dict[str, Any], price: float | None) -> dict[str, Any]:
    """Où en est la position ouverte entre son stop et son objectif, en R."""
    entry, sl, tp = position.get("avg_price"), position.get("sl"), position.get("tp")
    if not entry or not sl or price is None:
        return {}
    risk = abs(float(entry) - float(sl))
    if risk <= 0:
        return {}
    side = 1 if float(position.get("units", 0)) > 0 else -1
    r_now = side * (float(price) - float(entry)) / risk
    r_target = (side * (float(tp) - float(entry)) / risk) if tp else None
    return {
        "r_now": round(r_now, 3),
        "r_target": round(r_target, 3) if r_target else None,
        "entry": entry, "sl": sl, "tp": tp, "price": price,
        # position du prix sur l'axe SL -> TP, en fraction (0 = SL, 1 = TP)
        "progress": round(
            max(0.0, min(1.0, (r_now + 1.0) / ((r_target or 3.0) + 1.0))), 4),
    }


# ------------------------------------------------------------------ façade

def compute(backtest: dict[str, Any], candles: dict[str, list[list[Any]]],
            live_trades: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    trades = backtest.get("trades", [])
    risk = float(backtest.get("risk_pct") or 0.0)
    return {
        "excursions": excursions(trades, candles),
        "streaks": streaks(trades),
        "time": by_time(trades),
        "rolling_expectancy": rolling_expectancy(trades),
        "monte_carlo": monte_carlo(trades, risk),
        "costs": costs(trades),
        "n_backtest_trades": len(trades),
        "n_live_trades": len(live_trades or []),
    }
