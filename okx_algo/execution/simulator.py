"""Simulateur de remplissage maker-first (§10).

Un ordre limite passif n'est PAS rempli a coup sur. Le modele retenu :

  1. l'ordre est poste a `offset_ticks` du prix de reference, du bon cote ;
  2. il ne peut etre rempli que si le prix est effectivement venu le chercher
     pendant la barre (verifie sur le chemin reel : low pour un achat,
     high pour une vente) ;
  3. meme touche, la file d'attente peut ne pas etre purgee. La probabilite de
     remplissage croit avec la penetration du prix au-dela de la limite,
     normalisee par l'amplitude de la barre ;
  4. apres `timeout_bars` sans remplissage, l'ordre bascule en taker et paie
     le spread — c'est le cout de la certitude d'execution.

Le tirage utilise un RNG seede : deux backtests identiques donnent le meme
resultat, et le seed fait partie de l'etat persistant.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .costs import CostModel


@dataclass
class MakerParams:
    enabled: bool
    offset_ticks: int
    timeout_bars: int
    base_fill_probability: float
    vol_sensitivity: float

    @classmethod
    def from_config(cls, cfg) -> "MakerParams":
        return cls(
            enabled=cfg.get("costs.maker.enabled"),
            offset_ticks=cfg.get("costs.maker.offset_ticks"),
            timeout_bars=cfg.get("costs.maker.timeout_bars"),
            base_fill_probability=cfg.get("costs.maker.base_fill_probability"),
            vol_sensitivity=cfg.get("costs.maker.vol_sensitivity"),
        )


@dataclass
class Fill:
    price: float
    qty: float          # en contrats, signe
    fee: float
    is_maker: bool
    slippage_frac: float


class FillSimulator:
    def __init__(self, cost_model: CostModel, maker: MakerParams, rng: np.random.Generator):
        self.costs = cost_model
        self.maker = maker
        self.rng = rng
        self.n_maker_attempts = 0
        self.n_maker_filled = 0

    # ------------------------------------------------------------------
    def maker_limit_price(self, side: int, ref: float, tick: float) -> float:
        """Achat sous le mid, vente au-dessus : on attend que le marche vienne."""
        return ref - side * self.maker.offset_ticks * tick

    def try_maker(self, side: int, limit: float, bar_low: float, bar_high: float,
                  bar_range: float) -> bool:
        """Le prix a-t-il traverse la limite, et la file a-t-elle ete purgee ?"""
        self.n_maker_attempts += 1
        touched = (bar_low <= limit) if side > 0 else (bar_high >= limit)
        if not touched:
            return False
        penetration = (limit - bar_low) if side > 0 else (bar_high - limit)
        scale = max(bar_range * 0.25, limit * 1e-5)
        depth = float(np.clip(penetration / scale, 0.0, 1.0))
        p = self.maker.base_fill_probability + (1.0 - self.maker.base_fill_probability) * depth
        filled = bool(self.rng.random() < p)
        self.n_maker_filled += int(filled)
        return filled

    # ------------------------------------------------------------------
    def execute_taker(self, side: int, qty: float, ref: float, ct_val: float,
                      atr_frac: float, bar_notional: float, vol_ratio: float) -> Fill:
        notional_guess = abs(qty) * ct_val * ref
        px = self.costs.taker_price(side, ref, atr_frac, notional_guess, bar_notional, vol_ratio)
        notional = abs(qty) * ct_val * px
        return Fill(price=px, qty=qty, fee=self.costs.fee(notional, is_maker=False),
                    is_maker=False, slippage_frac=abs(px / ref - 1.0))

    def execute_maker(self, qty: float, limit: float, ct_val: float) -> Fill:
        notional = abs(qty) * ct_val * limit
        return Fill(price=limit, qty=qty, fee=self.costs.fee(notional, is_maker=True),
                    is_maker=True, slippage_frac=0.0)

    @property
    def maker_fill_rate(self) -> float:
        return self.n_maker_filled / self.n_maker_attempts if self.n_maker_attempts else 0.0
