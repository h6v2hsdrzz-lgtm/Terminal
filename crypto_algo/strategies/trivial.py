"""Stratégies triviales de validation du moteur (§10, phase 2).

Elles ne servent pas à gagner de l'argent : elles servent à vérifier que le
moteur ne fabrique pas d'argent. Si la stratégie **aléatoire** est rentable
dans le backtest, le moteur est faux — frais, slippage ou funding sont mal
appliqués, ou il reste un lookahead.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import Config
from ..data.loader import MarketData
from ..features.indicators import atr_pct as atr_pct_ind
from .base import Strategy


class BuyAndHoldStrategy(Strategy):
    """Achète et conserve. Le stop est placé très loin (garde-fou du moteur)."""

    name = "buy_and_hold"

    def __init__(self, cfg: Config | None = None, stop_pct: float = 0.09, symbols: list[str] | None = None):
        super().__init__(cfg, stop_pct=stop_pct)
        self.stop_pct = stop_pct
        self.symbols = symbols

    def prepare(self, md: MarketData, cfg: Config) -> None:
        tf = cfg.get_path("data.execution_timeframe")
        period = int(cfg.get_path("features.atr_period"))
        symbols = self.symbols or md.symbols
        for symbol in md.symbols:
            df = md.get(symbol, tf)
            dec = self.empty_decisions(df.index)
            if symbol in symbols and not df.empty:
                dec["signal"] = 1.0
                dec["stop_price"] = df["close"] * (1.0 - self.stop_pct)
                dec["atr_pct"] = atr_pct_ind(df, period).fillna(0.0)
                dec["families"] = "buy_and_hold"
            self._decisions[symbol] = dec


class RandomEntryStrategy(Strategy):
    """Entrées aléatoires, sizing identique à la stratégie réelle (contrôle négatif).

    Tirage indépendant du prix : l'espérance brute est nulle, l'espérance nette
    doit être **négative** du montant des coûts.
    """

    name = "random_entries"

    def __init__(
        self,
        cfg: Config | None = None,
        entry_probability: float = 0.01,
        atr_stop_mult: float = 2.0,
        atr_tp_mult: float = 3.0,
        seed: int = 1234,
    ):
        super().__init__(cfg, entry_probability=entry_probability, seed=seed)
        self.p = entry_probability
        self.atr_stop_mult = atr_stop_mult
        self.atr_tp_mult = atr_tp_mult
        self.seed = seed

    def prepare(self, md: MarketData, cfg: Config) -> None:
        tf = cfg.get_path("data.execution_timeframe")
        period = int(cfg.get_path("features.atr_period"))
        rng = np.random.default_rng(self.seed)
        for symbol in md.symbols:
            df = md.get(symbol, tf)
            dec = self.empty_decisions(df.index)
            if df.empty:
                self._decisions[symbol] = dec
                continue
            n = len(df)
            draw = rng.random(n)
            direction = np.where(rng.random(n) < 0.5, -1.0, 1.0)
            signal = np.where(draw < self.p, direction, 0.0)
            a = atr_pct_ind(df, period).fillna(0.0).to_numpy()
            close = df["close"].to_numpy(float)
            stop_dist = np.clip(a * self.atr_stop_mult, 0.004, 0.09)
            tp_dist = np.clip(a * self.atr_tp_mult, 0.006, 0.15)
            stop = np.where(signal > 0, close * (1 - stop_dist), close * (1 + stop_dist))
            tp = np.where(signal > 0, close * (1 + tp_dist), close * (1 - tp_dist))
            dec["signal"] = signal
            dec["stop_price"] = np.where(signal != 0, stop, np.nan)
            dec["take_profit"] = np.where(signal != 0, tp, np.nan)
            dec["atr_pct"] = a
            dec["families"] = "random"
            self._decisions[symbol] = dec


class AlwaysFlatStrategy(Strategy):
    """Ne trade jamais — vérifie que l'equity reste strictement constante."""

    name = "always_flat"

    def prepare(self, md: MarketData, cfg: Config) -> None:
        tf = cfg.get_path("data.execution_timeframe")
        for symbol in md.symbols:
            self._decisions[symbol] = self.empty_decisions(md.get(symbol, tf).index)
