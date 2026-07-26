"""Famille d) — Retournements.

Divergences prix/RSI et prix/MACD (régulières et cachées), climax de volume,
mèches de rejet, RSI en extrême avec confirmation de reversion, échec de
cassure (failed breakout).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import SignalContext, SignalFamily, sign_score


class ReversalFamily(SignalFamily):
    name = "reversal"

    def raw_components(self, ctx: SignalContext) -> dict[str, pd.Series]:
        out: dict[str, pd.Series] = {}
        rsi_high = float(ctx.cfg.get_path("signals.rsi_overbought", 72.0))
        rsi_low = float(ctx.cfg.get_path("signals.rsi_oversold", 28.0))
        climax_vol = float(ctx.cfg.get_path("signals.volume_climax_ratio", 3.0))
        wick_thr = float(ctx.cfg.get_path("signals.rejection_wick_ratio", 0.6))

        for tf in self.timeframes:
            close = ctx.col("close", tf)
            if close.isna().all():
                continue

            # --- divergences régulières (retournement) ---
            out[f"div_rsi_regular_{tf}"] = sign_score(
                ctx.col("rsi_div_regular_bull", tf).fillna(0.0) > 0,
                ctx.col("rsi_div_regular_bear", tf).fillna(0.0) > 0,
            )
            out[f"div_macd_regular_{tf}"] = sign_score(
                ctx.col("macd_div_regular_bull", tf).fillna(0.0) > 0,
                ctx.col("macd_div_regular_bear", tf).fillna(0.0) > 0,
            )
            # --- divergences cachées (continuation) : signal de même sens que la tendance ---
            out[f"div_rsi_hidden_{tf}"] = sign_score(
                ctx.col("rsi_div_hidden_bull", tf).fillna(0.0) > 0,
                ctx.col("rsi_div_hidden_bear", tf).fillna(0.0) > 0,
            )

            # --- RSI en extrême + début de reversion (le pur extrême ne suffit pas) ---
            rsi = ctx.col("rsi", tf)
            rsi_prev = rsi.shift(1)
            out[f"rsi_extreme_{tf}"] = sign_score(
                (rsi_prev <= rsi_low) & (rsi > rsi_prev),
                (rsi_prev >= rsi_high) & (rsi < rsi_prev),
            )

            # --- climax de volume : volume anormal + mèche de rejet ---
            rel_vol = ctx.col("rel_volume", tf)
            upper_wick = ctx.col("upper_wick_ratio", tf)
            lower_wick = ctx.col("lower_wick_ratio", tf)
            climax = rel_vol >= climax_vol
            out[f"volume_climax_{tf}"] = sign_score(
                climax & (lower_wick >= wick_thr),
                climax & (upper_wick >= wick_thr),
            )

            # --- mèches de rejet seules (sans climax) ---
            out[f"rejection_wick_{tf}"] = 0.5 * sign_score(
                lower_wick >= wick_thr, upper_wick >= wick_thr
            )

            # --- échec de cassure : le prix casse un swing puis referme derrière ---
            swing_high = ctx.col("swing_high", tf)
            swing_low = ctx.col("swing_low", tf)
            high = ctx.col("high", tf)
            low = ctx.col("low", tf)
            failed_up = (high > swing_high) & (close < swing_high)
            failed_down = (low < swing_low) & (close > swing_low)
            out[f"failed_breakout_{tf}"] = sign_score(failed_down, failed_up)

        return out
