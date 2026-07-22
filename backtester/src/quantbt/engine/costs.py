"""Execution costs: spread (with pessimistic mode), slippage, commissions, funding."""

from __future__ import annotations

from quantbt.config import CostConfig


def half_spread(price: float, cfg: CostConfig) -> float:
    """Half-spread in price units, inflated by the pessimistic multiplier."""
    s = cfg.spread
    full = s.value * price if s.mode == "pct" else s.value
    return 0.5 * full * s.pessimistic_mult


def fill_price(price: float, side: int, cfg: CostConfig) -> float:
    """Adverse fill: pay half-spread plus slippage in the direction that hurts.

    ``side`` is +1 when buying, -1 when selling.
    """
    adverse = half_spread(price, cfg) + cfg.slippage_pct * price
    return price + side * adverse


def commission(notional: float, cfg: CostConfig) -> float:
    return abs(notional) * cfg.commission_pct


def funding_cost(notional: float, bars_held: int, bars_per_day: float, cfg: CostConfig) -> float:
    """Funding on open notional, prorated per bar (crypto perps; 0 disables)."""
    if cfg.funding_daily_pct == 0.0 or bars_per_day <= 0:
        return 0.0
    return abs(notional) * cfg.funding_daily_pct * (bars_held / bars_per_day)
