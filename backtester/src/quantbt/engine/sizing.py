"""Position sizing: fixed fractional risk of equity, capped by max leverage."""

from __future__ import annotations

from quantbt.config import RiskConfig


def position_size(equity: float, entry: float, sl: float, cfg: RiskConfig) -> float:
    """Quantity such that hitting the SL loses ``risk_pct`` of current equity.

    Returns 0.0 when the stop distance is degenerate or equity is exhausted.
    """
    dist = abs(entry - sl)
    if dist <= 0 or equity <= 0 or entry <= 0:
        return 0.0
    qty = equity * cfg.risk_pct / dist
    max_qty = equity * cfg.max_leverage / entry
    return min(qty, max_qty)
