"""Famille a) — Tendance.

EMA 20/50/200 multi-timeframe, pente des EMA, alignement inter-TF, ADX/DMI,
Supertrend, structure de marché (higher highs / lower lows).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import SignalContext, SignalFamily, gate, mean_of, sign_score, squash


class TrendFamily(SignalFamily):
    name = "trend"

    def raw_components(self, ctx: SignalContext) -> dict[str, pd.Series]:
        idx = ctx.own.index
        out: dict[str, pd.Series] = {}
        periods = list(ctx.cfg.get_path("features.ema_periods"))
        slope_scale = float(ctx.cfg.get_path("signals.trend_slope_scale", 0.0008))
        adx_full = float(ctx.cfg.get_path("regime.adx_trend_threshold")) * 2.0

        align_per_tf: dict[str, pd.Series] = {}
        for tf in self.timeframes:
            close = ctx.col("close", tf)
            if close.isna().all():
                continue
            emas = {p: ctx.col(f"ema_{p}", tf) for p in periods}

            # --- alignement des EMA : 20 > 50 > 200 (et prix au-dessus) ---
            up = pd.Series(True, index=idx)
            down = pd.Series(True, index=idx)
            ordered = sorted(periods)
            for fast, slow in zip(ordered[:-1], ordered[1:]):
                up &= emas[fast] > emas[slow]
                down &= emas[fast] < emas[slow]
            up &= close > emas[ordered[-1]]
            down &= close < emas[ordered[-1]]
            align = sign_score(up, down)
            align_per_tf[tf] = align
            out[f"ema_align_{tf}"] = align

            # --- pente de l'EMA moyenne, normalisée ---
            slope = ctx.col(f"ema_{ordered[len(ordered) // 2]}_slope", tf)
            out[f"ema_slope_{tf}"] = squash(slope.fillna(0.0), slope_scale)

            # --- direction DMI, pondérée par la force ADX ---
            plus_di, minus_di, adx = ctx.col("plus_di", tf), ctx.col("minus_di", tf), ctx.col("adx", tf)
            di_dir = sign_score(plus_di > minus_di, minus_di > plus_di)
            out[f"dmi_{tf}"] = gate(di_dir, adx / adx_full)

            # --- Supertrend ---
            st = ctx.col("st_trend", tf)
            out[f"supertrend_{tf}"] = st.fillna(0.0).clip(-1.0, 1.0)

            # --- structure de marché : HH/HL vs LH/LL ---
            hh = ctx.col("higher_high", tf).fillna(0.0)
            ll = ctx.col("lower_low", tf).fillna(0.0)
            out[f"structure_{tf}"] = (hh - ll).clip(-1.0, 1.0)

        # --- cohérence inter-timeframes : bonus si tous les TF pointent pareil ---
        if len(align_per_tf) >= 2:
            stacked = pd.DataFrame(align_per_tf)
            agreement = stacked.mean(axis=1)
            unanimity = (stacked.abs().sum(axis=1) > 0) & (
                stacked.apply(lambda r: len(set(r[r != 0])) <= 1, axis=1)
            )
            out["multi_tf_alignment"] = np.sign(agreement) * unanimity.astype(float)
        return out


class BreakoutFamily(SignalFamily):
    """Cassure de structure et pullback sur EMA — entrées de suivi de tendance.

    Séparée de ``TrendFamily`` : celle-ci mesure l'état de la tendance, celle-là
    propose un **point d'entrée** dans cette tendance.
    """

    name = "breakout"

    def raw_components(self, ctx: SignalContext) -> dict[str, pd.Series]:
        out: dict[str, pd.Series] = {}
        exec_tf = str(ctx.cfg.get_path("data.execution_timeframe"))
        for tf in [t for t in self.timeframes if t != exec_tf][:2] or [exec_tf]:
            close = ctx.col("close", tf)
            if close.isna().all():
                continue
            swing_high = ctx.col("swing_high", tf)
            swing_low = ctx.col("swing_low", tf)
            out[f"structure_break_{tf}"] = sign_score(close > swing_high, close < swing_low)

            # pullback : le prix revient sur l'EMA 50 dans le sens de la tendance
            ema50 = ctx.col("ema_50", tf)
            ema200 = ctx.col("ema_200", tf)
            atr = ctx.col("atr", tf)
            near_ema = (close - ema50).abs() <= atr.fillna(np.inf)
            out[f"pullback_{tf}"] = sign_score(
                near_ema & (ema50 > ema200) & (close > ema200),
                near_ema & (ema50 < ema200) & (close < ema200),
            )
        return out
