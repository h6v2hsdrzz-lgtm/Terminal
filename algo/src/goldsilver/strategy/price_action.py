"""Stratégies price-action / SMC : bougies excessives, gaps, FVG, liquidity sweep.

Ces hypothèses sont demandées pour tenter d'augmenter la rentabilité. Elles
sont toutes soumises à la MÊME validation anti-overfitting que le reste — et
testées avec un scepticisme renforcé : essayer beaucoup de stratégies sur le
même historique gonfle la probabilité qu'une paraisse robuste par hasard
(problème des tests multiples). Un « gagnant » ne compte que s'il bat
NETTEMENT l'edge déjà validé (breakout 4h) hors échantillon.

Toutes opèrent sur un timeframe configurable (``timeframe``, 4h par défaut) :
la stratégie renvoie la frame de CE timeframe augmentée des colonnes de
signal ; le moteur exécute à l'ouverture de la bougie suivante (pas de
look-ahead — vérifié par un test d'invariance au futur). SL/TP standardisés
en ATR pour comparer les edges à sizing/risque identiques.
"""

from __future__ import annotations

from typing import Any, ClassVar, Mapping

import numpy as np
import pandas as pd

from goldsilver.strategy.base import Strategy, register
from goldsilver.strategy.indicators import atr


def _frame(self: Strategy, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
    tf = str(self.params["timeframe"])
    if tf not in tfs:
        raise KeyError(f"{self.name} : timeframe {tf!r} absent des données")
    return tfs[tf]


def _finish(frame: pd.DataFrame, signal: np.ndarray, atr_vals: pd.Series,
            sl_mult: float, tp_rr: float) -> pd.DataFrame:
    sl_dist = sl_mult * atr_vals
    valid = sl_dist.notna() & (sl_dist > 0)
    out = frame.copy()
    out["signal"] = np.where(valid.to_numpy(), signal, 0).astype(np.int8)
    out["sl_dist"] = sl_dist
    out["tp_dist"] = tp_rr * sl_dist
    return out


@register
class ExcessiveCandleReversion(Strategy):
    """Fade des bougies « excessives » : range >> ATR -> retour à la moyenne.

    Une bougie dont l'amplitude dépasse ``range_atr_mult`` x ATR traduit un
    mouvement exagéré ; on parie sur un pullback (short après une bougie
    haussière excessive, long après une baissière). Hypothèse mean-reversion,
    l'opposé du suivi de tendance — voir si un edge de repli existe.
    """

    name: ClassVar[str] = "excessive_candle_reversion"

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {"timeframe": "4h", "atr_period": 14, "range_atr_mult": 2.0,
                "sl_atr_mult": 2.0, "tp_rr": 3.0, "max_bars_held": 30,
                "direction": "both"}

    def generate(self, asset: str, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
        p = self.params
        frame = _frame(self, tfs)
        a = atr(frame, int(p["atr_period"]))
        rng = frame["high"] - frame["low"]
        excessive = rng > float(p["range_atr_mult"]) * a
        bullish = frame["close"] > frame["open"]
        sig = np.zeros(len(frame), dtype=np.int8)
        direction = str(p["direction"])
        if direction in ("both", "short"):
            sig = np.where((excessive & bullish).to_numpy(), -1, sig)   # fade la hausse
        if direction in ("both", "long"):
            sig = np.where((excessive & ~bullish).to_numpy(), 1, sig)   # fade la baisse
        return _finish(frame, sig, a, float(p["sl_atr_mult"]), float(p["tp_rr"]))


@register
class GapFill(Strategy):
    """Joue le comblement des gaps d'ouverture (fréquents sur les métaux).

    Un gap (open vs close précédent) > ``gap_atr_mult`` x ATR tend à se
    combler : gap baissier -> long (retour vers le close de la veille), gap
    haussier -> short. SL/TP standardisés en ATR.
    """

    name: ClassVar[str] = "gap_fill"

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {"timeframe": "4h", "atr_period": 14, "gap_atr_mult": 1.0,
                "sl_atr_mult": 2.0, "tp_rr": 3.0, "max_bars_held": 20,
                "direction": "both"}

    def generate(self, asset: str, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
        p = self.params
        frame = _frame(self, tfs)
        a = atr(frame, int(p["atr_period"]))
        gap = frame["open"] - frame["close"].shift(1)
        thr = float(p["gap_atr_mult"]) * a
        sig = np.zeros(len(frame), dtype=np.int8)
        direction = str(p["direction"])
        if direction in ("both", "long"):
            sig = np.where((gap < -thr).to_numpy(), 1, sig)     # gap down -> fill up
        if direction in ("both", "short"):
            sig = np.where((gap > thr).to_numpy(), -1, sig)     # gap up -> fill down
        return _finish(frame, sig, a, float(p["sl_atr_mult"]), float(p["tp_rr"]))


@register
class FairValueGap(Strategy):
    """Fair Value Gap (SMC) : imbalance sur 3 bougies -> continuation.

    FVG haussier à la bougie i : ``low[i] > high[i-2]`` (trou de prix non
    comblé, déséquilibre acheteur). SMC anticipe une continuation ; on entre
    long. Miroir baissier (``high[i] < low[i-2]``) -> short. Le déséquilibre
    doit valoir au moins ``min_gap_atr`` x ATR pour être significatif.
    ``mode='fade'`` teste l'hypothèse inverse (comblement du gap).
    """

    name: ClassVar[str] = "fair_value_gap"

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {"timeframe": "4h", "atr_period": 14, "min_gap_atr": 0.25,
                "sl_atr_mult": 2.0, "tp_rr": 3.0, "max_bars_held": 30,
                "mode": "continuation"}

    def generate(self, asset: str, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
        p = self.params
        frame = _frame(self, tfs)
        a = atr(frame, int(p["atr_period"]))
        min_gap = float(p["min_gap_atr"]) * a
        bull_gap = frame["low"] - frame["high"].shift(2)     # > 0 => FVG haussier
        bear_gap = frame["low"].shift(2) - frame["high"]     # > 0 => FVG baissier
        bull = bull_gap > min_gap
        bear = bear_gap > min_gap
        sig = np.zeros(len(frame), dtype=np.int8)
        long_dir, short_dir = (1, -1) if str(p["mode"]) == "continuation" else (-1, 1)
        sig = np.where(bull.to_numpy(), long_dir, sig)
        sig = np.where(bear.to_numpy(), short_dir, sig)
        return _finish(frame, sig, a, float(p["sl_atr_mult"]), float(p["tp_rr"]))


@register
class LiquiditySweep(Strategy):
    """Liquidity sweep / stop hunt (SMC) : balayage d'un extrême puis reversal.

    Le prix pique au-delà d'un plus-haut de swing (``swing_lookback`` bougies)
    pour prendre la liquidité, puis clôture EN DESSOUS : piège haussier ->
    short. Miroir sur les plus-bas -> long. Hypothèse de retournement après
    chasse aux stops.
    """

    name: ClassVar[str] = "liquidity_sweep"

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {"timeframe": "4h", "atr_period": 14, "swing_lookback": 20,
                "sl_atr_mult": 2.0, "tp_rr": 3.0, "max_bars_held": 30,
                "direction": "both"}

    def generate(self, asset: str, tfs: Mapping[str, pd.DataFrame]) -> pd.DataFrame:
        p = self.params
        frame = _frame(self, tfs)
        a = atr(frame, int(p["atr_period"]))
        n = int(p["swing_lookback"])
        # extrêmes des n bougies PRÉCÉDENTES (shift(1) => causal, pas de look-ahead)
        prior_high = frame["high"].rolling(n, min_periods=n).max().shift(1)
        prior_low = frame["low"].rolling(n, min_periods=n).min().shift(1)
        bear_sweep = (frame["high"] > prior_high) & (frame["close"] < prior_high)
        bull_sweep = (frame["low"] < prior_low) & (frame["close"] > prior_low)
        sig = np.zeros(len(frame), dtype=np.int8)
        direction = str(p["direction"])
        if direction in ("both", "short"):
            sig = np.where(bear_sweep.to_numpy(), -1, sig)
        if direction in ("both", "long"):
            sig = np.where(bull_sweep.to_numpy(), 1, sig)
        return _finish(frame, sig, a, float(p["sl_atr_mult"]), float(p["tp_rr"]))
