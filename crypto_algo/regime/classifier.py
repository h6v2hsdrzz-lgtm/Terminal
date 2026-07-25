"""Classifieur de régime de marché (§5).

Quatre états, calculés sur 4h (primaire) confirmés par 1h :

* ``trend_up``       — tendance haussière établie
* ``trend_down``     — tendance baissière établie
* ``range``          — marché sans direction, bornes exploitables
* ``high_vol_chaos`` — volatilité extrême : aucune position

Le classifieur applique une **persistance minimale** : un régime ne bascule
qu'après confirmation sur N barres du timeframe primaire. Sans cela, le routage
oscille à chaque bougie et la stratégie se retrouve à payer des frais pour
changer d'avis.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import Config
from ..signals.base import SignalContext
from ..signals.range_detect import range_strength
from ..utils import get_logger

log = get_logger("regime.classifier")

TREND_UP = "trend_up"
TREND_DOWN = "trend_down"
RANGE = "range"
CHAOS = "high_vol_chaos"
REGIMES = (TREND_UP, TREND_DOWN, RANGE, CHAOS)


@dataclass
class RegimeDiagnostics:
    """Séries intermédiaires, conservées pour l'audit du classement."""

    raw: pd.Series
    stable: pd.Series
    adx_primary: pd.Series
    chop_primary: pd.Series
    atr_pctile: pd.Series
    range_strength: pd.Series
    confirm: pd.Series

    def frame(self) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "regime_raw": self.raw,
                "regime": self.stable,
                "adx": self.adx_primary,
                "chop": self.chop_primary,
                "atr_pctile": self.atr_pctile,
                "range_strength": self.range_strength,
                "confirmed_by_secondary": self.confirm,
            }
        )


class RegimeClassifier:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        r = cfg.sub("regime")
        self.primary = str(r["primary_timeframe"])
        self.timeframes = list(r["timeframes"])
        self.secondary = [tf for tf in self.timeframes if tf != self.primary]
        self.adx_trend = float(r["adx_trend_threshold"])
        self.adx_range = float(r["adx_range_threshold"])
        self.chaos_pctile = float(r["chaos_atr_percentile"])
        self.persistence = int(r["min_regime_persistence"])

    def classify(self, ctx: SignalContext) -> RegimeDiagnostics:
        idx = ctx.own.index
        tf = self.primary

        adx = ctx.col("adx", tf)
        plus_di = ctx.col("plus_di", tf)
        minus_di = ctx.col("minus_di", tf)
        chop = ctx.col("chop", tf)
        atr_pctile = ctx.col("atr_pctile", tf)
        close = ctx.col("close", tf)
        ema_fast = ctx.col("ema_20", tf)
        ema_slow = ctx.col("ema_200", tf)
        strength = range_strength(ctx, tf)

        trending = adx >= self.adx_trend
        up = trending & (plus_di > minus_di) & (close > ema_slow) & (ema_fast > ema_slow)
        down = trending & (minus_di > plus_di) & (close < ema_slow) & (ema_fast < ema_slow)
        chaos = atr_pctile >= self.chaos_pctile

        raw = pd.Series(RANGE, index=idx, dtype=object)
        raw[up.fillna(False)] = TREND_UP
        raw[down.fillna(False)] = TREND_DOWN
        # le chaos prime sur tout : c'est une interdiction, pas une opinion
        raw[chaos.fillna(False)] = CHAOS

        # --- confirmation par le TF secondaire ---
        confirm = pd.Series(True, index=idx)
        for stf in self.secondary:
            s_plus = ctx.col("plus_di", stf)
            s_minus = ctx.col("minus_di", stf)
            agree_up = (raw == TREND_UP) & (s_plus >= s_minus)
            agree_down = (raw == TREND_DOWN) & (s_minus >= s_plus)
            neutral = ~raw.isin([TREND_UP, TREND_DOWN])
            confirm &= (agree_up | agree_down | neutral).fillna(False)

        # une tendance non confirmée par le TF inférieur est traitée en range
        adjusted = raw.copy()
        unconfirmed = (~confirm) & raw.isin([TREND_UP, TREND_DOWN])
        adjusted[unconfirmed] = RANGE

        stable = self._apply_persistence(adjusted)
        return RegimeDiagnostics(
            raw=raw, stable=stable, adx_primary=adx, chop_primary=chop,
            atr_pctile=atr_pctile, range_strength=strength, confirm=confirm,
        )

    def _apply_persistence(self, regimes: pd.Series) -> pd.Series:
        """Une bascule n'est retenue qu'après ``persistence`` barres identiques.

        Exception : ``high_vol_chaos`` s'applique immédiatement (protection).
        """
        n = self.persistence
        values = regimes.to_numpy(dtype=object)
        out = np.empty(len(values), dtype=object)
        current = values[0] if len(values) else RANGE
        streak_value, streak = current, 0
        for i, v in enumerate(values):
            if v == CHAOS:
                current = CHAOS
                streak_value, streak = CHAOS, n
            elif v == streak_value:
                streak += 1
                if streak >= n:
                    current = v
            else:
                streak_value, streak = v, 1
                if n <= 1:
                    current = v
            out[i] = current
        return pd.Series(out, index=regimes.index, dtype=object)


def regime_summary(regimes: pd.Series) -> pd.DataFrame:
    counts = regimes.value_counts()
    total = len(regimes)
    return pd.DataFrame(
        {
            "bars": counts,
            "share": (counts / max(total, 1)).round(4),
        }
    ).reindex(list(REGIMES)).fillna(0).astype({"bars": int})
