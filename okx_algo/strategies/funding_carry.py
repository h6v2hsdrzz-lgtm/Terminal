"""Brique 5 — carry de funding RELATIF entre actifs (recherche post-OOS).

Mecanisme. Le funding d'un perpetuel est paye par le cote surcharge. Il est
persistant : sur 2020-2026 le funding BTC est positif 85,5 % du temps, soit
+11,9 %/an paye par les longs. Une position short perp encaisse ce flux.

Mais un short outright est un pari directionnel. L'idee ici est differente :
**short le perp au funding le plus eleve, long celui au funding le plus bas**,
en neutralite dollar. On encaisse alors le DIFFERENTIEL de funding tout en
restant approximativement neutre au marche, puisque BTC, ETH et SOL ont des
betas crypto voisins (correlation des rendements ~0,8).

Difference essentielle avec ce qu'interdit le §6 du mandat : il ne s'agit pas
de porter le carry outright — dont le Sharpe s'est effondre — mais d'exploiter
la DISPERSION du funding entre actifs, qui ne se comprime pas de la meme facon
puisqu'elle reflete des desequilibres de positionnement locaux.

Le funding etant regle toutes les 8 h, la position est rebalancee sur ce cycle.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..data.panel import Panel
from ..features.core import shift1
from .base import Brick, BrickOutput

HOURS_PER_YEAR = 24 * 365


class FundingCarry(Brick):
    name = "funding_carry"
    kind = "core"

    def compute(self, panel: Panel) -> BrickOutput:
        p = self.params
        bph = 60.0 / {"1m": 1, "15m": 15, "1H": 60, "4H": 240, "1D": 1440}[panel.timeframe]
        bars_per_year = HOURS_PER_YEAR * bph
        smooth_bars = max(2, int(round(p.get("smooth_days", 3) * 24 * bph)))
        vol_window = max(8, int(round(p.get("vol_estimator_window_days", 20) * 24 * bph)))
        target_vol = float(p["target_vol_annualized"])
        gross = float(p.get("gross_exposure", 1.0))
        max_abs = float(p.get("max_abs_position", 1.0))

        n, m = panel.n, len(panel.symbols)

        # taux de funding annualise et lisse, propage entre deux reglements
        rates = np.full((n, m), np.nan)
        for j, sym in enumerate(panel.symbols):
            f = panel.data[sym].funding
            s = pd.Series(np.where(f != 0.0, f, np.nan)).ffill()
            # 3 reglements par jour -> annualisation
            rates[:, j] = (s.rolling(smooth_bars, min_periods=1).mean().to_numpy()
                           * 3 * 365)

        valid = panel.valid_matrix() & np.isfinite(rates)
        # ecart au funding moyen de l'univers : c'est le differentiel qu'on capte
        with np.errstate(invalid="ignore"):
            mu = np.nanmean(np.where(valid, rates, np.nan), axis=1, keepdims=True)
        spread = np.where(valid, rates - mu, np.nan)

        # short le funding le plus eleve, long le plus bas, neutre en dollars
        weights = np.zeros((n, m))
        for i in range(n):
            row = spread[i]
            idx = np.where(np.isfinite(row))[0]
            if len(idx) < 2:
                continue
            order = idx[np.argsort(row[idx])]
            lo, hi = order[0], order[-1]
            if row[hi] - row[lo] < float(p.get("min_spread_annual", 0.05)):
                continue          # differentiel trop faible pour payer les frais
            weights[i, lo] = gross * 0.5
            weights[i, hi] = -gross * 0.5

        # vol targeting du spread
        port = np.zeros(n)
        for j, sym in enumerate(panel.symbols):
            c = panel.data[sym].close.astype(float)
            with np.errstate(divide="ignore", invalid="ignore"):
                r = np.nan_to_num(np.diff(np.log(c), prepend=np.nan))
            port += weights[:, j] * r
        realized = (pd.Series(port).rolling(vol_window, min_periods=vol_window // 4)
                    .std().to_numpy() * np.sqrt(bars_per_year))
        with np.errstate(divide="ignore", invalid="ignore"):
            scale = np.where(realized > 1e-9, target_vol / realized, 0.0)
        scale = np.clip(np.nan_to_num(shift1(scale, fill=0.0)), 0.0, 20.0)
        weights = weights * scale[:, None]

        weights = Brick.hold_on_grid(weights, panel.index,
                                     p.get("rebalance_timeframe", "1D"))
        out = Brick.empty(panel, kind=self.kind)
        out.weights = Brick.sanitize(shift1(weights, fill=0.0), panel, max_abs)
        active = np.abs(out.weights).sum(axis=1) > 1e-9
        out.diagnostics = {
            "heures_actives": int(active.sum()),
            "part_du_temps_active": float(active.mean()),
            "spread_annualise_moyen": float(np.nanmean(
                np.nanmax(spread, axis=1) - np.nanmin(spread, axis=1))),
            "mean_gross": float(np.nanmean(np.abs(out.weights).sum(axis=1))),
        }
        return out
