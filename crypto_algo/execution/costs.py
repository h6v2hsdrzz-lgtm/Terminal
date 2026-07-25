"""Modèle de coûts : frais, slippage composite, funding.

Le réalisme d'exécution est le point qui invalide la plupart des backtests
(§7). Aucun de ces postes n'est optionnel : sur un trade de plusieurs jours en
levier x10, funding + frais + slippage pèsent plus que l'edge supposé.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import Config
from ..utils import get_logger, to_utc

log = get_logger("execution.costs")


@dataclass
class CostBreakdown:
    fee: float = 0.0
    slippage_cost: float = 0.0
    slippage_pct: float = 0.0
    fill_price: float = 0.0


class CostModel:
    """Frais + slippage. ``stress_multiplier`` sert au test de robustesse (§8.7)."""

    def __init__(self, cfg: Config, stress_multiplier: float = 1.0):
        self.cfg = cfg
        fees = cfg.sub("execution.fees")
        slip = cfg.sub("execution.slippage")
        self.stress = float(stress_multiplier)
        self.taker = float(fees["taker"]) * self.stress
        self.maker = float(fees["maker"]) * self.stress
        self.default_order_type = str(fees["default_order_type"])
        self.spread_bps = float(slip["spread_bps"]) * self.stress
        self.vol_coef = float(slip["vol_coefficient"]) * self.stress
        self.impact_coef = float(slip["impact_coefficient"]) * self.stress
        self.max_slippage = float(slip["max_slippage_pct"])

    def fee_rate(self, order_type: str | None = None) -> float:
        ot = order_type or self.default_order_type
        return self.maker if ot == "maker" else self.taker

    def slippage_pct(
        self,
        atr_pct: float = 0.0,
        size_notional: float = 0.0,
        bar_volume_notional: float = 0.0,
    ) -> float:
        """spread fixe + composante volatilité + impact de taille."""
        spread = self.spread_bps / 10_000.0 / 2.0  # demi-spread traversé
        vol = self.vol_coef * (atr_pct if np.isfinite(atr_pct) else 0.0)
        impact = 0.0
        if bar_volume_notional and bar_volume_notional > 0:
            impact = self.impact_coef * (size_notional / bar_volume_notional)
        total = spread + vol + impact
        return float(min(max(total, 0.0), self.max_slippage))

    def apply(
        self,
        price: float,
        side: str,
        quantity: float,
        atr_pct: float = 0.0,
        bar_volume_notional: float = 0.0,
        order_type: str | None = None,
    ) -> CostBreakdown:
        """``side`` = sens de l'ordre ('buy'/'sell'), slippage toujours défavorable."""
        notional = abs(quantity) * price
        slip = self.slippage_pct(atr_pct, notional, bar_volume_notional)
        direction = 1.0 if side == "buy" else -1.0
        fill = price * (1.0 + direction * slip)
        fee = abs(quantity) * fill * self.fee_rate(order_type)
        return CostBreakdown(
            fee=fee,
            slippage_cost=abs(fill - price) * abs(quantity),
            slippage_pct=slip,
            fill_price=fill,
        )


class FundingModel:
    """Application du funding réel toutes les 8h sur le notionnel de la position."""

    def __init__(self, cfg: Config, funding: dict[str, pd.DataFrame] | None = None,
                 stress_multiplier: float = 1.0):
        self.cfg = cfg
        f = cfg.sub("execution.funding")
        self.enabled = bool(f["enabled"])
        self.hours = list(f["hours_utc"])
        self.fallback = float(f["fallback_rate"])
        self.stress = float(stress_multiplier)
        self.rates: dict[str, pd.Series] = {}
        self.sources: dict[str, pd.Series] = {}
        for symbol, df in (funding or {}).items():
            if df is None or len(df) == 0:
                continue
            s = df.copy()
            if "timestamp" in s.columns and not isinstance(s.index, pd.DatetimeIndex):
                s.index = pd.to_datetime(s["timestamp"], unit="ms", utc=True)
            s = s.sort_index()
            self.rates[symbol] = s["funding_rate"].astype(float)
            if "source" in s.columns:
                self.sources[symbol] = s["source"]

    def settlements_between(self, t0, t1) -> pd.DatetimeIndex:
        """Règlements dans l'intervalle ]t0, t1]."""
        t0, t1 = to_utc(t0), to_utc(t1)
        if t1 <= t0:
            return pd.DatetimeIndex([], tz="UTC")
        days = pd.date_range(t0.normalize(), t1.normalize() + pd.Timedelta(days=1), freq="D", tz="UTC")
        stamps = pd.DatetimeIndex(sorted(d + pd.Timedelta(hours=h) for d in days for h in self.hours))
        return stamps[(stamps > t0) & (stamps <= t1)]

    def rate_at(self, symbol: str, ts) -> float:
        series = self.rates.get(symbol)
        if series is None or series.empty:
            return self.fallback * self.stress
        ts = to_utc(ts)
        idx = series.index.searchsorted(ts, side="right") - 1
        if idx < 0:
            return self.fallback * self.stress
        # tolérance : le règlement doit être proche du timestamp demandé
        if abs((series.index[idx] - ts).total_seconds()) > 8 * 3600:
            return self.fallback * self.stress
        value = float(series.iloc[idx])
        return value * self.stress

    def source_at(self, symbol: str, ts) -> str:
        series = self.sources.get(symbol)
        if series is None or series.empty:
            return "fallback"
        ts = to_utc(ts)
        idx = series.index.searchsorted(ts, side="right") - 1
        return str(series.iloc[idx]) if idx >= 0 else "fallback"

    def payment(self, symbol: str, ts, side: str, notional: float) -> float:
        """Montant payé (négatif) ou reçu (positif) par la position.

        Convention perp : funding positif => les longs paient les shorts.
        """
        if not self.enabled:
            return 0.0
        rate = self.rate_at(symbol, ts)
        sign = -1.0 if side == "long" else 1.0
        return sign * rate * abs(notional)
