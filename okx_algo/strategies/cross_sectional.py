"""Brique 2 — momentum cross-sectionnel (§5).

    x[i] = r[i,168h] / sigma[i,168h]
    z[i] = z-score de x[i] en coupe sur l'univers
    long le plus haut, short le plus bas, poids nul au median
    neutralite en dollars : notionnel long = notionnel short
    rebalancement quotidien

Limite a documenter, pas a masquer : sur 3 actifs, le z-score en coupe n'a que
3 points. Le rang median est mecaniquement nul et la strategie se reduit a un
seul spread long/short. C'est un univers tres etroit pour du cross-sectionnel.
Le code accepte un univers etendu (`universe: extended`) precisement pour
mesurer si l'elargissement ameliore le Sharpe out-of-sample — c'est l'objet de
l'hypothese H2.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from ..data.panel import Panel
from ..features.core import ewma_vol, log_return, shift1
from .base import Brick, BrickOutput


class CrossSectionalMomentum(Brick):
    name = "cross_sectional"
    kind = "core"

    def compute(self, panel: Panel) -> BrickOutput:
        p = self.params
        bph = 60.0 / {"1m": 1, "15m": 15, "1H": 60, "4H": 240, "1D": 1440}[panel.timeframe]
        lookback = max(1, int(round(int(p["lookback_hours"]) * bph)))
        halflife_bars = float(p["vol_halflife_days"]) * 24.0 * bph
        max_abs = float(p.get("max_abs_position", 1.0))
        gross = float(p.get("gross_exposure", 1.0))

        n, m = panel.n, len(panel.symbols)
        x = np.full((n, m), np.nan)
        for j, sym in enumerate(panel.symbols):
            close = panel.data[sym].close.astype(float)
            with np.errstate(divide="ignore", invalid="ignore"):
                bar_ret = np.diff(np.log(close), prepend=np.nan)
            sigma_h = ewma_vol(bar_ret, halflife_bars) * np.sqrt(lookback)
            r = log_return(close, lookback)
            with np.errstate(divide="ignore", invalid="ignore"):
                x[:, j] = np.where(sigma_h > 0, r / sigma_h, np.nan)

        valid = panel.valid_matrix() & np.isfinite(x)
        weights = _rank_weights(x, valid, gross)

        # rebalancement quotidien : on fige les poids entre deux dates
        weights = Brick.hold_on_grid(weights, panel.index,
                                     p.get("rebalance_timeframe", "1D"))

        out = Brick.empty(panel, kind=self.kind)
        out.weights = Brick.sanitize(shift1(weights, fill=0.0), panel, max_abs)
        long_notional = np.clip(out.weights, 0, None).sum(axis=1)
        short_notional = np.clip(-out.weights, 0, None).sum(axis=1)
        active = (long_notional + short_notional) > 1e-9
        out.diagnostics = {
            "n_symbols": m,
            "mean_gross": float(np.nanmean(np.abs(out.weights).sum(axis=1))),
            "dollar_neutrality_max_abs_gap": float(
                np.nanmax(np.abs(long_notional - short_notional)[active])) if active.any() else 0.0,
            "active_hours": int(active.sum()),
        }
        return out


def _rank_weights(x: np.ndarray, valid: np.ndarray, gross: float) -> np.ndarray:
    """Long le plus haut, short le plus bas, zero au median. Neutre en dollars."""
    n, m = x.shape
    w = np.zeros((n, m))
    xm = np.where(valid, x, np.nan)
    counts = valid.sum(axis=1)

    # z-score en coupe, conserve pour la ponderation quand l'univers est large.
    # Une ligne entierement NaN (aucun actif cote) est un cas legitime : on
    # neutralise l'avertissement plutot que de masquer le calcul.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        mu = np.nanmean(xm, axis=1, keepdims=True)
        sd = np.nanstd(xm, axis=1, keepdims=True)
    with np.errstate(invalid="ignore", divide="ignore"):
        z = np.where(sd > 0, (xm - mu) / sd, 0.0)
    z = np.where(np.isfinite(z), z, np.nan)

    rows = np.where(counts >= 2)[0]
    for i in rows:
        row = xm[i]
        idx = np.where(np.isfinite(row))[0]
        if len(idx) < 2:
            continue
        order = idx[np.argsort(row[idx])]
        k = max(1, len(order) // 3) if len(order) >= 6 else 1
        shorts, longs = order[:k], order[-k:]
        if len(order) >= 6:
            # univers large : ponderation par le z-score dans chaque tranche
            wl = np.abs(np.nan_to_num(z[i, longs]))
            ws = np.abs(np.nan_to_num(z[i, shorts]))
            wl = wl / wl.sum() if wl.sum() > 0 else np.ones(len(longs)) / len(longs)
            ws = ws / ws.sum() if ws.sum() > 0 else np.ones(len(shorts)) / len(shorts)
        else:
            wl = np.ones(len(longs)) / len(longs)
            ws = np.ones(len(shorts)) / len(shorts)
        w[i, longs] = gross * 0.5 * wl
        w[i, shorts] = -gross * 0.5 * ws
    return w


def _hold_daily(weights: np.ndarray, index: pd.DatetimeIndex) -> np.ndarray:
    """Ne conserve la decision qu'a 00:00 UTC, propagee sur la journee."""
    # sur une grille infra-horaire, seule la barre 00:00 pile est un reset
    is_reset = (index.hour == 0) & (index.minute == 0)
    held = np.where(is_reset[:, None], weights, np.nan)
    return pd.DataFrame(held).ffill().fillna(0.0).to_numpy()
