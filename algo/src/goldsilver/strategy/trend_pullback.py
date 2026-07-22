"""Stratégie exemple : tendance daily + pullback RSI en 1h, SL ATR, TP à R:R fixé.

Logique (identique pour l'or et l'argent — l'argent, plus volatil, est
automatiquement traité par le sizing en % de risque et le SL en ATR, qui
réduisent la taille quand la volatilité monte ; la corrélation or/argent est
gérée par le moteur via ``corr_risk_factor``) :

- Filtre de tendance : clôture daily > EMA(``trend_ema``) => haussier
  (valeur de la VEILLE, alignée sans look-ahead).
- Entrée long : en tendance haussière, le RSI 1h repasse AU-DESSUS de
  ``rsi_buy`` (il était en dessous à la bougie précédente) — fin de repli.
- Entrée short : miroir en tendance baissière avec le seuil ``100 - rsi_buy``.
- SL : ``sl_atr_mult`` x ATR(1h) sous/sur l'entrée. TP : ``tp_rr`` x SL
  (R:R >= 1:3 par défaut). Stop temps : ``max_bars_held`` bougies.
"""

from __future__ import annotations

from typing import Any, ClassVar, Mapping

import numpy as np
import pandas as pd

from goldsilver.data.timeframes import align_to_base
from goldsilver.strategy.base import Strategy, register
from goldsilver.strategy.indicators import atr, ema, rsi


@register
class TrendPullbackStrategy(Strategy):
    name: ClassVar[str] = "trend_pullback"

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {
            "trend_timeframe": "1d",
            "trend_ema": 50,
            "rsi_period": 14,
            "rsi_buy": 40.0,
            "atr_period": 14,
            "sl_atr_mult": 2.0,
            "tp_rr": 3.0,
            "max_bars_held": 120,
            "direction": "both",
        }

    def generate(self, asset: str, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
        p = self.params
        base = next(iter(tfs.values()))  # premier TF = base par convention
        trend_tf = str(p["trend_timeframe"])
        if trend_tf not in tfs:
            raise KeyError(f"{self.name} : timeframe de tendance {trend_tf!r} absent")

        high_tf = tfs[trend_tf]
        trend_ema = ema(high_tf["close"], int(p["trend_ema"]))
        # Tendance de la dernière bougie daily TERMINÉE, projetée sur la base.
        close_d = align_to_base(base.index, high_tf["close"], shift=1)
        ema_d = align_to_base(base.index, trend_ema, shift=1)
        up = close_d > ema_d
        down = close_d < ema_d

        r = rsi(base["close"], int(p["rsi_period"]))
        buy_th = float(p["rsi_buy"])
        sell_th = 100.0 - buy_th
        cross_up = (r.shift(1) < buy_th) & (r >= buy_th)
        cross_down = (r.shift(1) > sell_th) & (r <= sell_th)

        a = atr(base, int(p["atr_period"]))
        direction = str(p["direction"])
        long_ok = direction in ("both", "long")
        short_ok = direction in ("both", "short")

        signal = np.zeros(len(base), dtype=np.int8)
        if long_ok:
            signal = np.where(up.to_numpy() & cross_up.to_numpy(), 1, signal)
        if short_ok:
            signal = np.where(down.to_numpy() & cross_down.to_numpy(), -1, signal)

        sl_dist = float(p["sl_atr_mult"]) * a
        tp_dist = float(p["tp_rr"]) * sl_dist
        valid = sl_dist.notna() & (sl_dist > 0) & ema_d.notna()
        signal = np.where(valid.to_numpy(), signal, 0)

        out = base.copy()
        out["signal"] = signal
        out["sl_dist"] = sl_dist
        out["tp_dist"] = tp_dist
        return out
