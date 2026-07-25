"""Modele de couts OKX : frais, spread, slippage, impact (§10).

Aucun de ces postes n'est optionnel. Le stress des couts (x1.5, x2) agit sur
un multiplicateur global applique ici, ce qui garantit que frais, spread,
slippage et impact sont stresses ensemble.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class CostParams:
    maker_fee: float
    taker_fee: float
    spread_bps_base: float
    spread_bps_max: float
    slippage_atr_fraction: float
    impact_coefficient: float
    stress: float = 1.0

    @classmethod
    def from_config(cls, cfg, stress: float = 1.0) -> "CostParams":
        return cls(
            maker_fee=cfg.get("costs.maker_fee"),
            taker_fee=cfg.get("costs.taker_fee"),
            spread_bps_base=cfg.get("costs.spread_bps_base"),
            spread_bps_max=cfg.get("costs.spread_bps_max"),
            slippage_atr_fraction=cfg.get("costs.slippage_atr_fraction"),
            impact_coefficient=cfg.get("costs.impact_coefficient"),
            stress=stress,
        )


class CostModel:
    """Couts d'un aller simple. Toutes les grandeurs sont en fraction du prix."""

    def __init__(self, params: CostParams):
        self.p = params

    # ------------------------------------------------------------------
    def spread(self, vol_ratio: float) -> float:
        """Demi-spread en fraction de prix. S'elargit quand la vol depasse sa norme."""
        excess = float(np.clip(vol_ratio - 1.0, 0.0, 2.0)) / 2.0
        bps = self.p.spread_bps_base + (self.p.spread_bps_max - self.p.spread_bps_base) * excess
        return (bps * 1e-4 / 2.0) * self.p.stress

    def slippage(self, atr_frac: float, notional: float, bar_notional: float) -> float:
        """Slippage au-dela du spread : composante volatilite + impact de taille."""
        vol_part = self.p.slippage_atr_fraction * max(atr_frac, 0.0)
        denom = max(bar_notional, 1.0)
        impact = self.p.impact_coefficient * min(notional / denom, 0.25)
        return (vol_part + impact) * self.p.stress

    # ------------------------------------------------------------------
    def taker_price(self, side: int, ref: float, atr_frac: float,
                    notional: float, bar_notional: float, vol_ratio: float) -> float:
        """side = +1 achat, -1 vente. Le cout va toujours contre nous."""
        adverse = self.spread(vol_ratio) + self.slippage(atr_frac, notional, bar_notional)
        return ref * (1.0 + side * adverse)

    def fee(self, notional: float, is_maker: bool) -> float:
        rate = self.p.maker_fee if is_maker else self.p.taker_fee
        return abs(notional) * rate * self.p.stress
