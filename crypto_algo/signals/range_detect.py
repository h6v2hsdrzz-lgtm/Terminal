"""Famille c) — Détection de range et signal de retour à la moyenne.

Largeur des bandes de Bollinger, Keltner, percentile d'ATR, Choppiness Index,
bornes support/résistance obtenues par clustering des touches.

Deux sorties distinctes :

* ``range_strength(ctx)`` — à quel point le marché **est** en range, dans
  ``[0, 1]``. Utilisé par le classifieur de régime.
* ``score(ctx)`` — le signal directionnel de retour à la moyenne : acheter la
  borne basse, vendre la borne haute, et **uniquement** si le range est établi.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import SignalContext, SignalFamily, gate


def range_strength(ctx: SignalContext, timeframe: str | None = None) -> pd.Series:
    """Force du régime de range dans [0, 1] (0 = tendance franche)."""
    cfg = ctx.cfg
    tf = timeframe or str(cfg.get_path("regime.primary_timeframe"))
    idx = ctx.own.index

    chop = ctx.col("chop", tf)
    adx = ctx.col("adx", tf)
    bb_pct = ctx.col("bb_width_pctile", tf)
    atr_pct = ctx.col("atr_pctile", tf)

    chop_thr = float(cfg.get_path("regime.chop_range_threshold"))
    adx_thr = float(cfg.get_path("regime.adx_range_threshold"))

    # chaque composante dans [0, 1], 1 = très « range »
    c_chop = ((chop - chop_thr) / (100.0 - chop_thr)).clip(0.0, 1.0)
    c_adx = ((adx_thr - adx) / adx_thr).clip(0.0, 1.0)
    c_width = (1.0 - bb_pct).clip(0.0, 1.0)
    c_atr = (1.0 - atr_pct).clip(0.0, 1.0)
    strength = pd.concat([c_chop, c_adx, c_width, c_atr], axis=1).mean(axis=1, skipna=True)
    return strength.reindex(idx).fillna(0.0)


class RangeFamily(SignalFamily):
    name = "range"

    def raw_components(self, ctx: SignalContext) -> dict[str, pd.Series]:
        out: dict[str, pd.Series] = {}
        strength = range_strength(ctx)

        for tf in self.timeframes:
            close = ctx.col("close", tf)
            if close.isna().all():
                continue

            # --- position dans les bandes de Bollinger : +1 en bas, -1 en haut ---
            mid = ctx.col("bb_mid", tf)
            upper = ctx.col("bb_upper", tf)
            lower = ctx.col("bb_lower", tf)
            half_width = (upper - mid).replace(0.0, np.nan)
            z = ((close - mid) / half_width).clip(-2.0, 2.0)
            out[f"bb_position_{tf}"] = gate(-(z / 2.0).fillna(0.0), strength)

            # --- position dans les bandes de Keltner (confirme la compression) ---
            kc_mid = ctx.col("kc_mid", tf)
            kc_up = ctx.col("kc_upper", tf)
            kc_half = (kc_up - kc_mid).replace(0.0, np.nan)
            zk = ((close - kc_mid) / kc_half).clip(-2.0, 2.0)
            out[f"kc_position_{tf}"] = gate(-(zk / 2.0).fillna(0.0), strength)

            # --- bornes support / résistance par clustering des touches ---
            support = ctx.col("support", tf)
            resistance = ctx.col("resistance", tf)
            atr = ctx.col("atr", tf)
            if not support.isna().all():
                near_support = (close - support).abs() <= atr
                near_resistance = (resistance - close).abs() <= atr
                sr = near_support.fillna(False).astype(float) - near_resistance.fillna(False).astype(float)
                out[f"sr_touch_{tf}"] = gate(sr, strength)

        out["range_strength"] = pd.Series(0.0, index=ctx.own.index)  # neutre, informatif
        return out

    def score(self, ctx: SignalContext) -> pd.Series:
        components = {k: v for k, v in self.raw_components(ctx).items() if k != "range_strength"}
        if not components:
            return pd.Series(0.0, index=ctx.own.index)
        return pd.DataFrame(components).mean(axis=1, skipna=True).fillna(0.0).clip(-1, 1).rename(self.name)
