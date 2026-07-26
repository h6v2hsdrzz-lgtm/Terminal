"""Cassure de canal (Donchian) en 4h — hypothèse testée séparément.

Le principe est celui des « turtles » : entrer quand le prix franchit le plus
haut des ``N`` dernières bougies, sortir quand il franchit le plus bas des ``M``
dernières (ou sur le stop ATR). C'est du suivi de tendance pur, sans catalogue
d'indicateurs : une seule hypothèse économique — *les mouvements qui sortent
d'une consolidation ont tendance à se prolonger* — et deux paramètres.

Anti-lookahead : le canal est calculé sur les bougies 4h **closes**, en excluant
la bougie courante du calcul des extrêmes, puis aligné sur la timeline
d'exécution par instant de disponibilité (une bougie 4h ouverte à 08:00 n'est
utilisable qu'à 12:00). L'exécution reste à l'ouverture de la barre suivante.

Contrainte à connaître avant de lire les résultats : le cahier des charges
impose une détention maximale de 5 jours (``risk.max_holding_days``). Un suivi
de tendance vit de quelques trades tenus plusieurs semaines ; couper à 5 jours
retire précisément la queue de distribution qui le finance. Le script de test
mesure donc les deux régimes, et le dit.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import Config
from ..data.loader import MarketData
from ..features.indicators import atr as atr_ind, ema
from ..features.pipeline import align_to_execution
from ..utils import get_logger
from .base import Strategy

log = get_logger("strategies.breakout")


def _donchian_state(
    close: np.ndarray,
    upper: np.ndarray,
    lower: np.ndarray,
    exit_upper: np.ndarray,
    exit_lower: np.ndarray,
    allow_long: np.ndarray,
    allow_short: np.ndarray,
) -> np.ndarray:
    """État directionnel : entrée sur cassure, sortie sur canal opposé."""
    n = len(close)
    state = np.zeros(n)
    current = 0.0
    for i in range(n):
        c = close[i]
        if current == 0.0:
            if np.isfinite(upper[i]) and c > upper[i] and allow_long[i]:
                current = 1.0
            elif np.isfinite(lower[i]) and c < lower[i] and allow_short[i]:
                current = -1.0
        elif current > 0:
            if np.isfinite(exit_lower[i]) and c < exit_lower[i]:
                current = 0.0
        else:
            if np.isfinite(exit_upper[i]) and c > exit_upper[i]:
                current = 0.0
        state[i] = current
    return state


class DonchianBreakoutStrategy(Strategy):
    name = "donchian_breakout_4h"

    def __init__(
        self,
        cfg: Config,
        timeframe: str = "4h",
        entry_period: int = 20,
        exit_period: int = 10,
        atr_stop_mult: float = 2.0,
        atr_period: int = 14,
        trend_filter: bool = False,
        trend_period: int = 200,
        core_cache: dict | None = None,
        **overrides,
    ):
        super().__init__(cfg, **overrides)
        self.timeframe = str(overrides.get("timeframe", timeframe))
        self.entry_period = int(overrides.get("entry_period", entry_period))
        self.exit_period = int(overrides.get("exit_period", exit_period))
        self.atr_stop_mult = float(overrides.get("atr_stop_mult", atr_stop_mult))
        self.atr_period = int(overrides.get("atr_period", atr_period))
        self.trend_filter = bool(overrides.get("trend_filter", trend_filter))
        self.trend_period = int(overrides.get("trend_period", trend_period))
        self.core_cache = core_cache if core_cache is not None else {}
        self.diagnostics: dict[str, pd.DataFrame] = {}

    def prepare(self, md: MarketData, cfg: Config) -> None:
        exec_tf = str(cfg.get_path("data.execution_timeframe"))
        min_stop = float(cfg.get_path("strategy.min_stop_pct"))
        max_stop = float(cfg.get_path("strategy.max_stop_pct"))

        for symbol in md.symbols:
            exec_df = md.get(symbol, exec_tf)
            src = md.ohlcv.get((symbol, self.timeframe))
            if exec_df is None or exec_df.empty or src is None or src.empty:
                self._decisions[symbol] = self.empty_decisions(
                    exec_df.index if exec_df is not None else pd.DatetimeIndex([])
                )
                continue

            # --- canal calculé sur les bougies closes, barre courante exclue ---
            upper = src["high"].shift(1).rolling(self.entry_period, min_periods=self.entry_period).max()
            lower = src["low"].shift(1).rolling(self.entry_period, min_periods=self.entry_period).min()
            exit_up = src["high"].shift(1).rolling(self.exit_period, min_periods=self.exit_period).max()
            exit_dn = src["low"].shift(1).rolling(self.exit_period, min_periods=self.exit_period).min()
            atr = atr_ind(src, self.atr_period)

            if self.trend_filter:
                trend = ema(src["close"], self.trend_period)
                allow_long = (src["close"] > trend).fillna(False).to_numpy()
                allow_short = (src["close"] < trend).fillna(False).to_numpy()
            else:
                allow_long = np.ones(len(src), dtype=bool)
                allow_short = np.ones(len(src), dtype=bool)

            state = _donchian_state(
                src["close"].to_numpy(float), upper.to_numpy(float), lower.to_numpy(float),
                exit_up.to_numpy(float), exit_dn.to_numpy(float), allow_long, allow_short,
            )

            signals_4h = pd.DataFrame(
                {
                    "signal": state,
                    "atr_abs": atr.to_numpy(float),
                    "ref_close": src["close"].to_numpy(float),
                },
                index=src.index,
            )
            aligned = align_to_execution(signals_4h, self.timeframe, exec_df.index, exec_tf)

            dec = self.empty_decisions(exec_df.index)
            signal = aligned["signal"].fillna(0.0)
            close = exec_df["close"]
            # le stop suit l'ATR 4h connu à la dernière clôture disponible
            stop_dist = (self.atr_stop_mult * aligned["atr_abs"] / close).clip(min_stop, max_stop)
            stop_dist = stop_dist.ffill()

            dec["signal"] = signal
            dec["stop_price"] = np.where(
                signal > 0, close * (1 - stop_dist),
                np.where(signal < 0, close * (1 + stop_dist), np.nan),
            )
            dec["take_profit"] = np.nan          # le suivi de tendance ne coupe pas ses gains
            dec["atr_pct"] = (aligned["atr_abs"] / close).ffill().fillna(0.0)
            dec["regime"] = "breakout"
            dec["families"] = f"donchian_{self.entry_period}_{self.exit_period}"
            self._decisions[symbol] = dec
            self.diagnostics[symbol] = pd.DataFrame(
                {"signal": signal, "stop_distance": stop_dist}, index=exec_df.index
            )
            log.info(
                "%s cassure %dx%d en %s : %d changements d'état",
                symbol, self.entry_period, self.exit_period, self.timeframe,
                int((signal.diff().abs() > 0).sum()),
            )
