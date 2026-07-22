"""Sizing en % de risque, avec pas de taille, plafond de risque et de levier.

Fonctions pures — testées dans ``tests/test_sizing.py``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from goldsilver.config import AssetSpec


@dataclass(frozen=True)
class SizingDecision:
    units: float          # 0.0 => trade refusé
    risk_amount: float    # $ réellement risqués après arrondi
    reason: str           # "ok" | motif du refus / de la réduction


def position_size(
    equity: float,
    risk_pct: float,
    sl_dist: float,
    price: float,
    spec: AssetSpec,
    *,
    risk_factor: float = 1.0,
    risk_budget_left: float | None = None,
    max_leverage: float | None = None,
    open_notional: float = 0.0,
) -> SizingDecision:
    """Calcule la taille pour risquer ``risk_pct`` de l'equity sur ``sl_dist``.

    - ``risk_factor`` : réduction pour corrélation (position déjà ouverte sur
      le métal corrélé dans le même sens).
    - ``risk_budget_left`` : $ de risque encore autorisés (plafond global) ;
      la taille est réduite pour tenir dedans, jamais augmentée.
    - ``max_leverage`` : plafond de notionnel total / equity.
    """
    if equity <= 0:
        return SizingDecision(0.0, 0.0, "equity nulle ou négative")
    if sl_dist <= 0 or math.isnan(sl_dist):
        return SizingDecision(0.0, 0.0, "distance de SL invalide")
    if price <= 0:
        return SizingDecision(0.0, 0.0, "prix invalide")

    risk_amount = equity * risk_pct * risk_factor
    if risk_budget_left is not None:
        if risk_budget_left <= 0:
            return SizingDecision(0.0, 0.0, "budget de risque épuisé")
        risk_amount = min(risk_amount, risk_budget_left)

    per_unit_risk = sl_dist * spec.contract_size
    units = risk_amount / per_unit_risk

    if max_leverage is not None:
        notional_left = equity * max_leverage - open_notional
        if notional_left <= 0:
            return SizingDecision(0.0, 0.0, "levier max atteint")
        units = min(units, notional_left / (price * spec.contract_size))

    units = math.floor(units / spec.size_step) * spec.size_step
    if units < spec.min_size:
        return SizingDecision(0.0, 0.0, "taille sous le minimum")

    return SizingDecision(units, units * per_unit_risk, "ok")
