"""Brique 4 — contrarien sur le positionnement des comptes (recherche post-OOS).

Mecanisme economique, identifie AVANT le test et confirme par un scan d'IC :
le ratio long/short des comptes mesure le positionnement de la clientele de
detail. Quand elle est massivement d'un cote, deux forces jouent contre elle :

  * ses positions sont financees a credit et donc fragiles a un mouvement
    adverse — c'est le carburant des cascades de liquidations ;
  * elle est structurellement du mauvais cote aux extremes, parce qu'elle entre
    apres le mouvement, une fois le repricing deja fait.

Le signal est donc **contrarien** : on prend l'autre cote du positionnement
extreme, pas du positionnement moyen.

Mesure d'IC in-sample (2020-10 -> 2024-12), rendement futur a 72 h :
    IC moyen 0.067, de 0.060 a 0.075 selon l'actif, **de signe identique sur
    les trois**. C'est la stabilite transversale, plus que la magnitude, qui
    rend ce signal credible : trois actifs largement independants donnent le
    meme resultat.

Reserve honnete : le t-stat vaut 1,37 par actif une fois corrige du
chevauchement des fenetres — en dessous du seuil conventionnel de 2. La donnee
provient en outre du positionnement Binance, pas OKX, ce qui suppose que les
deux clienteles se positionnent de facon comparable (les marches sont
etroitement arbitres, mais ce n'est pas une identite).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..data.panel import Panel
from ..features.core import shift1, zscore
from .base import Brick, BrickOutput

HOURS_PER_YEAR = 24 * 365


class PositioningContrarian(Brick):
    name = "positioning"
    kind = "core"

    def compute(self, panel: Panel) -> BrickOutput:
        p = self.params
        bph = 60.0 / {"1m": 1, "15m": 15, "1H": 60, "4H": 240, "1D": 1440}[panel.timeframe]
        bars_per_year = HOURS_PER_YEAR * bph
        zwin = max(8, int(round(p.get("zscore_window_days", 30) * 24 * bph)))
        vol_window = max(8, int(round(p.get("vol_estimator_window_days", 20) * 24 * bph)))
        target_vol = float(p["target_vol_annualized"])
        k = float(p.get("k", 1.0))
        max_abs = float(p.get("max_abs_position", 1.0))

        n, m = panel.n, len(panel.symbols)
        weights = np.zeros((n, m))
        coverage = {}

        for j, sym in enumerate(panel.symbols):
            d = panel.data[sym]
            lsr = d.long_short_ratio
            if lsr is None or not np.isfinite(lsr).any():
                coverage[sym] = 0.0
                continue
            coverage[sym] = float(np.isfinite(lsr).mean())

            # z-score du LOG du ratio : le ratio est multiplicatif (2x long est
            # l'oppose de 0.5x long), le log le rend symetrique.
            z = zscore(np.log(np.clip(lsr, 1e-6, None)), zwin)
            signal = -np.tanh(np.nan_to_num(z) / k)      # contrarien

            close = d.close.astype(float)
            with np.errstate(divide="ignore", invalid="ignore"):
                bar_ret = np.diff(np.log(close), prepend=np.nan)
            vol_ann = (pd.Series(bar_ret).rolling(vol_window, min_periods=vol_window // 4)
                       .std().to_numpy() * np.sqrt(bars_per_year))
            with np.errstate(divide="ignore", invalid="ignore"):
                scale = np.where(vol_ann > 1e-9, target_vol / vol_ann, 0.0)
            scale = np.clip(np.nan_to_num(scale), 0.0, 10.0)
            weights[:, j] = signal * scale

        weights = Brick.hold_on_grid(weights, panel.index,
                                     p.get("rebalance_timeframe", "1D"))
        out = Brick.empty(panel, kind=self.kind)
        out.weights = Brick.sanitize(shift1(weights, fill=0.0), panel, max_abs)
        out.diagnostics = {
            "couverture_donnee": coverage,
            "mean_abs_weight": float(np.nanmean(np.abs(out.weights))),
            "pct_long": float((out.weights > 0).mean()),
            "pct_short": float((out.weights < 0).mean()),
        }
        return out
