"""Famille b) — Momentum.

MACD (paramétrable), histogramme MACD et sa dérivée, RSI, Rate of Change,
momentum multi-timeframe.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import SignalContext, SignalFamily, sign_score, squash


class MomentumFamily(SignalFamily):
    name = "momentum"

    def raw_components(self, ctx: SignalContext) -> dict[str, pd.Series]:
        out: dict[str, pd.Series] = {}
        roc_scale = float(ctx.cfg.get_path("signals.momentum_roc_scale", 0.02))

        for tf in self.timeframes:
            close = ctx.col("close", tf)
            if close.isna().all():
                continue

            # --- MACD : position de la ligne, croisement, dynamique de l'histogramme ---
            macd_line = ctx.col("macd", tf)
            macd_sig = ctx.col("macd_signal", tf)
            hist = ctx.col("macd_hist", tf)
            hist_slope = ctx.col("macd_hist_slope", tf)
            norm = close.replace(0.0, np.nan)

            out[f"macd_cross_{tf}"] = sign_score(macd_line > macd_sig, macd_line < macd_sig)
            out[f"macd_hist_{tf}"] = squash((hist / norm).fillna(0.0), 0.002)
            # la dérivée de l'histogramme anticipe l'essoufflement
            out[f"macd_hist_slope_{tf}"] = squash((hist_slope / norm).fillna(0.0), 0.0004)

            # --- RSI centré ---
            rsi = ctx.col("rsi", tf)
            out[f"rsi_{tf}"] = ((rsi - 50.0) / 50.0).clip(-1.0, 1.0).fillna(0.0)

            # --- Rate of change ---
            out[f"roc_{tf}"] = squash(ctx.col("roc", tf).fillna(0.0), roc_scale)

        # --- accord multi-timeframes du momentum ---
        rsi_cols = [v for k, v in out.items() if k.startswith("rsi_")]
        if len(rsi_cols) >= 2:
            stacked = pd.concat(rsi_cols, axis=1)
            same_sign = (np.sign(stacked).abs().sum(axis=1) > 0) & (
                np.sign(stacked).nunique(axis=1) == 1
            )
            out["momentum_mtf_agreement"] = np.sign(stacked.mean(axis=1)) * same_sign.astype(float)
        return out
