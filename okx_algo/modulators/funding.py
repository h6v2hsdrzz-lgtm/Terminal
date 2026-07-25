"""Modulateur de funding (§6) — un multiplicateur, jamais une brique.

    f_z = z-score du funding 8h sur 30 jours glissants
    f_z > +2  -> toute exposition LONG  multipliee par 0.5
    f_z < -2  -> toute exposition SHORT multipliee par 0.5
    |f_z| > 3 -> biais contrarien autorise, sur la brique 3 uniquement

Raison d'etre : un funding extreme signale un positionnement surcharge d'un
cote, donc une fragilite aux cascades. Ce n'est pas un moteur de carry. Le
Sharpe du carry crypto s'est comprime (≈6,5 sur 2020-2025, ≈4 a partir de 2024,
negatif en 2025) : cet edge ne doit rien porter.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..data.panel import Panel
from ..features.core import shift1


def funding_zscore(panel: Panel, window_days: int) -> np.ndarray:
    """z-score du taux de funding, aligne sur la grille horaire.

    Le funding n'existe qu'aux heures de reglement : on travaille sur la serie
    des reglements puis on la propage, sinon les zeros intercalaires ecraseraient
    la moyenne et l'ecart-type.
    """
    n, m = panel.n, len(panel.symbols)
    z = np.zeros((n, m))
    window = max(int(window_days * 3), 5)      # 3 reglements par jour
    for j, sym in enumerate(panel.symbols):
        f = panel.data[sym].funding
        mask = f != 0.0
        if mask.sum() < window:
            continue
        s = pd.Series(np.where(mask, f, np.nan), index=panel.index)
        settled = s.dropna()
        mu = settled.rolling(window, min_periods=window // 2).mean()
        sd = settled.rolling(window, min_periods=window // 2).std()
        zz = ((settled - mu) / sd.replace(0.0, np.nan)).reindex(panel.index).ffill()
        z[:, j] = np.nan_to_num(zz.to_numpy(), nan=0.0, posinf=0.0, neginf=0.0)
    return shift1(z, fill=0.0)


def apply_funding_modulator(weights: np.ndarray, z: np.ndarray, cfg) -> np.ndarray:
    """Amortit le cote surcharge. N'inverse jamais un signe, n'en cree jamais."""
    if not cfg.get("funding_modulator.enabled"):
        return weights
    z_high = cfg.get("funding_modulator.z_high")
    z_low = cfg.get("funding_modulator.z_low")
    damp = cfg.get("funding_modulator.damping")
    mult = np.ones_like(weights)
    mult = np.where((weights > 0) & (z > z_high), damp, mult)
    mult = np.where((weights < 0) & (z < z_low), damp, mult)
    return weights * mult


def extreme_funding_mask(z: np.ndarray, cfg) -> np.ndarray:
    """|f_z| > 3 : autorise un biais contrarien, brique 3 uniquement."""
    return np.abs(z) > cfg.get("funding_modulator.extreme_z")
