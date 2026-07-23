"""Breakout Donchian daily, long-only, filtre de tendance EMA.

Hypothèse de marché : sur un actif en tendance séculaire (métaux 2019-2026),
les cassures de plus-haut N jours ont une continuation exploitable à
l'échelle daily/swing — et à cet horizon le spread pèse un ordre de
grandeur de moins que sur des trades 1h.

Choix a priori (déclarés AVANT de voir les résultats, comme pour les autres
stratégies) : long-only par défaut — vendre à découvert les cassures de
plus-bas d'un actif en bull séculaire s'est déjà montré destructeur dans la
stratégie précédente, et un système de cassure est directionnel par nature.
``direction: both`` reste disponible dans la config pour vérifier.

Signaux :
- cassure : clôture 1h > plus-haut des ``donchian_n`` derniers JOURS
  TERMINÉS (aligné sans look-ahead) ;
- filtre : clôture daily de la veille > EMA(``trend_ema``) daily ;
- SL : ``sl_atr_mult`` x ATR daily (aligné) ; TP : ``tp_rr`` x SL (>= 1:3) ;
- stop temps ``max_bars_held`` bougies 1h (~1 mois par défaut).
"""

from __future__ import annotations

from typing import Any, ClassVar, Mapping

import numpy as np
import pandas as pd

from goldsilver.data.timeframes import align_to_base
from goldsilver.strategy.base import Strategy, register
from goldsilver.strategy.indicators import atr, ema


@register
class DailyBreakoutStrategy(Strategy):
    name: ClassVar[str] = "daily_breakout"

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {
            "trend_timeframe": "1d",
            "donchian_n": 40,          # cassure de plus-haut 40 jours
            "trend_ema": 100,          # filtre de tendance daily
            "atr_period": 14,          # ATR daily pour le stop
            "sl_atr_mult": 2.5,
            "tp_rr": 3.0,              # R:R >= 1:3 (exigence utilisateur)
            "max_bars_held": 480,      # ~1 mois de bougies 1h
            "direction": "long",       # long | both
        }

    def generate(self, asset: str, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
        p = self.params
        base = next(iter(tfs.values()))
        tf = str(p["trend_timeframe"])
        if tf not in tfs:
            raise KeyError(f"{self.name} : timeframe {tf!r} absent")
        daily = tfs[tf]

        n = int(p["donchian_n"])
        upper_d = daily["high"].rolling(n, min_periods=n).max()
        lower_d = daily["low"].rolling(n, min_periods=n).min()
        ema_d = ema(daily["close"], int(p["trend_ema"]))
        atr_d = atr(daily, int(p["atr_period"]))

        # valeurs de la dernière bougie daily TERMINÉE, projetées sur la base
        upper = align_to_base(base.index, upper_d, shift=1)
        lower = align_to_base(base.index, lower_d, shift=1)
        trend_up = align_to_base(base.index, daily["close"], shift=1) > align_to_base(
            base.index, ema_d, shift=1
        )
        sl_dist = float(p["sl_atr_mult"]) * align_to_base(base.index, atr_d, shift=1)

        close = base["close"]
        cross_up = (close.shift(1) <= upper.shift(1)) & (close > upper)
        cross_down = (close.shift(1) >= lower.shift(1)) & (close < lower)

        direction = str(p["direction"])
        signal = np.zeros(len(base), dtype=np.int8)
        signal = np.where(cross_up.to_numpy() & trend_up.to_numpy(), 1, signal)
        if direction == "both":
            signal = np.where(
                cross_down.to_numpy() & (~trend_up.to_numpy()), -1, signal
            )

        valid = sl_dist.notna() & (sl_dist > 0) & upper.notna()
        signal = np.where(valid.to_numpy(), signal, 0)

        out = base.copy()
        out["signal"] = signal
        out["sl_dist"] = sl_dist
        out["tp_dist"] = float(p["tp_rr"]) * sl_dist
        return out
