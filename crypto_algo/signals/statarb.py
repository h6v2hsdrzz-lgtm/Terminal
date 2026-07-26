"""Famille g) — Arbitrage statistique.

Pas d'arbitrage de latence : non réalisable dans ce cadre (pas de colocation,
pas de flux tick, latence simulée de 200-500 ms). Ce qui reste exploitable :

* **funding carry** — quand le funding est extrême, le côté surpeuplé paie ; un
  funding très positif signale une surchauffe des longs et biaise à la vente ;
* **basis perp vs index** — écart normalisé, tension de portage ;
* **pair trading** ETH/BTC et SOL/BTC — retour à la moyenne du spread.

Anti-lookahead : un taux de funding réglé à 08:00 n'est connu qu'à 08:00. Les
séries sont donc alignées sur l'instant de règlement, jamais sur le début de la
période qu'elles rémunèrent.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..utils import rolling_zscore
from .base import SignalContext, SignalFamily, squash


def funding_on_index(funding: pd.DataFrame, index: pd.DatetimeIndex) -> pd.Series:
    """Dernier taux **déjà réglé** à chaque barre (aucune anticipation)."""
    if funding is None or funding.empty:
        return pd.Series(np.nan, index=index)
    s = funding["funding_rate"].astype(float).sort_index()
    left = pd.DataFrame(index=index).reset_index().rename(columns={"index": "dt", "dt": "dt"})
    right = s.reset_index()
    right.columns = ["settled_at", "funding_rate"]
    merged = pd.merge_asof(
        left.sort_values("dt"), right.sort_values("settled_at"),
        left_on="dt", right_on="settled_at", direction="backward", allow_exact_matches=True,
    )
    merged.index = left.sort_values("dt")["dt"].to_numpy()
    return merged["funding_rate"].reindex(index)


class StatArbFamily(SignalFamily):
    name = "statarb"

    def raw_components(self, ctx: SignalContext) -> dict[str, pd.Series]:
        out: dict[str, pd.Series] = {}
        cfg = ctx.cfg
        idx = ctx.own.index
        z_window_funding = int(cfg.get_path("statarb.funding_zscore_window"))
        z_window_basis = int(cfg.get_path("statarb.basis_zscore_window"))
        pair_window = int(cfg.get_path("statarb.pair_zscore_window"))
        entry_z = float(cfg.get_path("statarb.pair_entry_z"))
        pctile = float(cfg.get_path("statarb.funding_extreme_pctile"))

        # ------------------------------------------------------ funding carry
        funding = ctx.funding.get(ctx.symbol)
        rates = funding_on_index(funding, idx)
        if rates.notna().any():
            # z-score en « périodes de funding » : on ré-échantillonne en 8h
            settled = rates.resample("8h").last()
            z8 = rolling_zscore(settled, z_window_funding)
            z = z8.reindex(idx, method="ffill")
            extreme_hi = settled.rolling(z_window_funding, min_periods=z_window_funding // 4).quantile(pctile)
            extreme_lo = settled.rolling(z_window_funding, min_periods=z_window_funding // 4).quantile(1 - pctile)
            hi = extreme_hi.reindex(idx, method="ffill")
            lo = extreme_lo.reindex(idx, method="ffill")
            is_extreme = (rates >= hi) | (rates <= lo)
            # funding très positif = longs en surchauffe => biais vendeur
            out["funding_carry"] = (-squash(z.fillna(0.0), 2.0) * is_extreme.astype(float)).fillna(0.0)
            ctx.own["_funding_rate"] = rates
            ctx.own["_funding_z"] = z

        # ---------------------------------------------------------- basis
        index_df = ctx.index_price.get(ctx.symbol)
        if index_df is not None and not index_df.empty:
            index_close = index_df["close"].reindex(idx, method="ffill")
            perp_close = ctx.col("close").reindex(idx)
            basis = (perp_close - index_close) / index_close.replace(0.0, np.nan)
            zb = rolling_zscore(basis, z_window_basis)
            out["basis"] = (-squash(zb.fillna(0.0), 2.0) * (zb.abs() >= 1.5).astype(float)).fillna(0.0)
            ctx.own["_basis"] = basis

        # ----------------------------------------------------- pair trading
        pairs = [tuple(p) for p in cfg.get_path("statarb.pairs")]
        for leg, hedge in pairs:
            if leg != ctx.symbol or hedge not in ctx.features:
                continue
            leg_close = ctx.col("close").reindex(idx)
            hedge_close = ctx.features[hedge]["close"].reindex(idx)
            spread = np.log(leg_close) - np.log(hedge_close)
            zs = rolling_zscore(spread, pair_window)
            exit_z = float(cfg.get_path("statarb.pair_exit_z"))
            active = zs.abs() >= entry_z
            out["pair_spread"] = (-squash(zs.fillna(0.0), entry_z) * active.astype(float)).fillna(0.0)
            ctx.own["_pair_z"] = zs
            ctx.own["_pair_exit_z"] = pd.Series(exit_z, index=idx)
        return out
