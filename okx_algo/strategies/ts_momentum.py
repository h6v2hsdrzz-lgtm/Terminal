"""Brique 1 — momentum time-series vol-targete (§5).

    r[i,h]     = log(close[t] / close[t-h])
    sigma[i,h] = vol EWMA horaire (halflife 20 j) mise a l'echelle de h
    s[i,h]     = tanh( r[i,h] / (k * sigma[i,h]) )
    signal[i]  = moyenne des s[i,h] sur les horizons
    poids[i]   = signal[i] * (vol_cible / vol_realisee_20j[i])

Symetrie stricte : aucun terme n'introduit de biais long. tanh est impaire, la
mise a l'echelle par la volatilite est paire, donc le retournement du signe de
tous les rendements retourne exactement le signe de toutes les positions. C'est
verifie par un test.

Decalage : les features sont calculees sur l'information disponible a la
cloture de la barre N, puis la matrice de poids est decalee d'une barre. Le
moteur execute ensuite en N+1. Il y a donc deux barres entre l'information et
le remplissage — volontairement conservateur.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..data.panel import Panel
from ..features.core import ewma_vol, log_return, shift1
from .base import Brick, BrickOutput

HOURS_PER_YEAR = 24 * 365


class TSMomentum(Brick):
    name = "ts_momentum"
    kind = "core"

    def compute(self, panel: Panel) -> BrickOutput:
        p = self.params
        # toutes les fenetres du mandat sont exprimees en heures ou en jours :
        # elles sont converties en barres pour rester identiques quelle que soit
        # la resolution de la grille du moteur.
        bph = _bars_per_hour(panel.timeframe)
        bars_per_year = HOURS_PER_YEAR * bph
        horizons = [int(h) for h in p["horizons_hours"]]
        horizon_bars = [max(1, int(round(h * bph))) for h in horizons]
        k = float(p["k"])
        halflife_bars = float(p["vol_halflife_days"]) * 24.0 * bph
        target_vol = float(p["target_vol_annualized"])
        max_abs = float(p.get("max_abs_position", 1.0))
        vol_window = max(8, int(round(p.get("vol_estimator_window_days", 20) * 24 * bph)))

        n, m = panel.n, len(panel.symbols)
        weights = np.zeros((n, m))
        raw_signal = np.zeros((n, m))

        for j, sym in enumerate(panel.symbols):
            close = panel.data[sym].close.astype(float)
            with np.errstate(divide="ignore", invalid="ignore"):
                bar_ret = np.diff(np.log(close), prepend=np.nan)
            bar_ret = np.where(np.isfinite(bar_ret), bar_ret, np.nan)
            sigma_bar = ewma_vol(bar_ret, halflife_bars)

            s_sum = np.zeros(n)
            s_cnt = np.zeros(n)
            for h in horizon_bars:
                r = log_return(close, h)
                sigma_h = sigma_bar * np.sqrt(h)
                with np.errstate(divide="ignore", invalid="ignore"):
                    x = np.where(sigma_h > 0, r / (k * sigma_h), np.nan)
                s = np.tanh(x)
                ok = np.isfinite(s)
                s_sum = np.where(ok, s_sum + np.nan_to_num(s), s_sum)
                s_cnt = np.where(ok, s_cnt + 1.0, s_cnt)
            signal = np.where(s_cnt > 0, s_sum / np.maximum(s_cnt, 1.0), 0.0)

            # -- H7 (desactive par defaut) : qualite de la tendance ----------
            # Distingue une progression reguliere d'un saut unique deja integre.
            # N'utilise que des donnees deja presentes dans la brique.
            tq = p.get("trend_quality") or {}
            if float(tq.get("exponent", 0.0)) > 0:
                h_ref = max(horizon_bars)
                num = np.abs(log_return(close, h_ref))
                den = _rolling_abs_sum(bar_ret, h_ref)
                with np.errstate(divide="ignore", invalid="ignore"):
                    eff = np.where(den > 0, num / den, 0.0)
                eff = np.clip(np.nan_to_num(eff), 0.0, 1.0)
                signal = signal * eff ** float(tq["exponent"])

            # -- H4 (desactive par defaut) : filtre de regime de volatilite ---
            vrf = p.get("vol_regime_filter") or {}
            if vrf.get("enabled"):
                q = float(vrf.get("quantile", 0.95))
                red = float(vrf.get("reduction", 0.0))
                lookback = max(8, int(round(vrf.get("lookback_days", 365) * 24 * bph)))
                thresh = (pd.Series(sigma_bar).rolling(lookback, min_periods=lookback // 4)
                          .quantile(q).to_numpy())
                extreme = np.isfinite(thresh) & (sigma_bar > thresh)
                signal = np.where(extreme, signal * red, signal)

            # volatilite realisee annualisee, fenetre glissante 20 j
            vol_ann = (np.sqrt(np.maximum(
                _rolling_var(bar_ret, vol_window), 0.0)) * np.sqrt(bars_per_year))
            with np.errstate(divide="ignore", invalid="ignore"):
                scale = np.where(vol_ann > 1e-9, target_vol / vol_ann, 0.0)
            scale = np.clip(np.nan_to_num(scale, nan=0.0, posinf=0.0), 0.0, 10.0)

            # -- deadband anti-churn, applique sur le signal NORMALISE -------
            # Le §5 definit la position cible comme normalisee dans [-1, +1] et
            # place le deadband sur cette grandeur. C'est la seule echelle ou un
            # seuil de 0.20 a un sens : apres vol targeting a 10 % annualise les
            # poids vivent autour de 0.05, et un seuil absolu de 0.20 ne se
            # declencherait jamais. Le deadband gele donc le signal tant qu'il
            # n'a pas bouge de 0.20 en unites normalisees ; la mise a l'echelle
            # par la volatilite s'applique ensuite.
            signal = _apply_deadband(signal, float(p.get("deadband", 0.20)))

            raw_signal[:, j] = signal
            weights[:, j] = signal * scale

        weights = Brick.hold_on_grid(weights, panel.index,
                                     p.get("rebalance_timeframe", "1H"))
        out = Brick.empty(panel, kind=self.kind)
        out.weights = Brick.sanitize(shift1(weights, fill=0.0), panel, max_abs)
        out.diagnostics = {
            "mean_abs_signal": float(np.nanmean(np.abs(raw_signal))),
            "mean_abs_weight": float(np.nanmean(np.abs(out.weights))),
            "pct_long": float((out.weights > 0).mean()),
            "pct_short": float((out.weights < 0).mean()),
            "horizons": horizons,
        }
        return out


def _apply_deadband(signal: np.ndarray, band: float) -> np.ndarray:
    """Maintient la derniere cible tant que le signal n'a pas bouge de `band`."""
    if band <= 0:
        return signal
    out = np.empty_like(signal)
    held = 0.0
    for i in range(len(signal)):
        s = signal[i]
        if not np.isfinite(s):
            out[i] = held
            continue
        if abs(s - held) > band:
            held = s
        out[i] = held
    return out


def _bars_per_hour(timeframe: str) -> float:
    return 60.0 / {"1m": 1, "15m": 15, "1H": 60, "4H": 240, "1D": 1440}[timeframe]


def _rolling_var(a: np.ndarray, window: int) -> np.ndarray:
    return pd.Series(a).rolling(window, min_periods=max(8, window // 4)).var().to_numpy()


def _rolling_abs_sum(a: np.ndarray, window: int) -> np.ndarray:
    return (pd.Series(np.abs(a)).rolling(window, min_periods=window // 2)
            .sum().to_numpy())
