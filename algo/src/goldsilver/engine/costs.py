"""Coûts d'exécution : spread, slippage, swap overnight (CFD).

Convention de prix : les OHLCV sont des prix BID.
- Un long ACHÈTE à l'ask = bid + spread (le spread se paie à l'achat),
  et revend au bid (pas de coût supplémentaire).
- Un short vend au bid et RACHÈTE à l'ask (spread payé au débouclage).
Le spread complet est donc payé exactement une fois par aller-retour.

Le slippage s'applique aux exécutions au marché et aux stops (toujours dans
le sens défavorable). Les TP sont des ordres limites : exécutés au prix
limite, jamais mieux pour le backtest, et seulement si la bougie l'atteint.
"""

from __future__ import annotations

import math

import pandas as pd

from goldsilver.config import AssetCosts, CostsConfig


def effective_spread(cfg: CostsConfig, asset: str, bar_spread: float) -> float:
    """Spread appliqué à une bougie : mesuré (majoré) ou fixe selon la config."""
    ac = cfg.per_asset[asset]
    if cfg.spread_mode == "from_data" and not math.isnan(bar_spread) and bar_spread > 0:
        return bar_spread * cfg.pessimistic_spread_mult
    return ac.fixed_spread * (cfg.pessimistic_spread_mult if cfg.spread_mode == "from_data" else 1.0)


def swap_for_bar(
    cfg: CostsConfig, asset: str, side: int, units: float, contract_size: float,
    ts: pd.Timestamp,
) -> float:
    """Swap facturé si la bougie ``ts`` couvre l'heure de rollover, sinon 0.

    Convention métaux : le mercredi (par défaut) est facturé triple pour
    couvrir le week-end. Valeurs par unité et par nuit, négatives = coût.
    """
    if ts.hour != cfg.rollover_hour_utc:
        return 0.0
    ac: AssetCosts = cfg.per_asset[asset]
    per_night = ac.swap_long if side > 0 else ac.swap_short
    mult = 3.0 if ts.dayofweek == cfg.triple_swap_weekday else 1.0
    return units * contract_size * per_night * mult
