"""Simulateur d'exécution : fills, latence, rejets, liquidation, résolution intrabar.

Règles appliquées (§7) :

* signal en clôture de barre N -> exécution à l'**ouverture** de la barre N+1 ;
  jamais de fill au prix qui a généré le signal ;
* si SL et TP sont touchés dans la même barre, on descend en 1m ; à défaut,
  hypothèse pessimiste (SL d'abord) ;
* la liquidation est évaluée sur le **mark price** et prime sur tout le reste :
  le backtest ne suppose jamais que le stop protège toujours ;
* latence simulée 200-500 ms et rejets d'ordre occasionnels.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ..config import Config
from ..utils import get_logger, timeframe_to_ms, to_utc
from .costs import CostModel, FundingModel

log = get_logger("execution.simulator")


@dataclass
class Order:
    ts: pd.Timestamp
    symbol: str
    side: str                # "buy" | "sell"
    quantity: float
    intent: str              # "open_long" | "open_short" | "close"
    order_type: str = "taker"
    stop_loss: float | None = None
    take_profit: float | None = None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class Fill:
    ts: pd.Timestamp
    symbol: str
    side: str
    quantity: float
    price: float
    fee: float
    slippage_pct: float
    slippage_cost: float
    latency_ms: float
    reference_price: float


@dataclass
class ExitEvent:
    kind: str                # "stop_loss" | "take_profit" | "liquidation" | "timeout" | "signal"
    price: float
    ts: pd.Timestamp
    resolved_with: str = "assumption"   # "intrabar" | "assumption" | "single_touch"


class ExecutionSimulator:
    def __init__(
        self,
        cfg: Config,
        cost_model: CostModel | None = None,
        funding_model: FundingModel | None = None,
        rng: np.random.Generator | None = None,
        intrabar: dict[str, pd.DataFrame] | None = None,
    ):
        self.cfg = cfg
        self.costs = cost_model or CostModel(cfg)
        self.funding = funding_model or FundingModel(cfg)
        self.rng = rng or np.random.default_rng(int(cfg.get_path("backtest.seed")))
        self.intrabar = intrabar or {}
        lat = cfg.sub("execution.latency")
        self.latency_enabled = bool(lat["enabled"])
        self.latency_min = float(lat["min_ms"])
        self.latency_max = float(lat["max_ms"])
        rej = cfg.sub("execution.rejects")
        self.rejects_enabled = bool(rej["enabled"])
        self.reject_prob = float(rej["probability"])
        ib = cfg.sub("execution.intrabar")
        self.resolve_intrabar = bool(ib["resolve_with_intrabar"])
        self.pessimistic = bool(ib["pessimistic_fallback"])
        self.intrabar_tf = str(cfg.get_path("data.intrabar_timeframe"))
        self.exec_tf_ms = timeframe_to_ms(str(cfg.get_path("data.execution_timeframe")))
        self.stats = {
            "orders": 0, "rejected": 0, "fills": 0,
            "ambiguous_bars": 0, "resolved_intrabar": 0, "resolved_assumption": 0,
        }

    # ------------------------------------------------------------------ fills
    def execute(
        self,
        order: Order,
        bar: pd.Series,
        atr_pct: float = 0.0,
        reference: str = "open",
        price_override: float | None = None,
    ) -> Fill | None:
        """Exécute un ordre marché sur la barre fournie. ``None`` si rejeté."""
        self.stats["orders"] += 1
        if self.rejects_enabled and self.rng.random() < self.reject_prob:
            self.stats["rejected"] += 1
            log.debug("ordre rejeté par l'exchange : %s %s", order.symbol, order.intent)
            return None

        base_price = float(price_override if price_override is not None else bar[reference])
        latency_ms = 0.0
        if self.latency_enabled:
            latency_ms = float(self.rng.uniform(self.latency_min, self.latency_max))
            # la latence expose l'ordre au chemin de prix intrabar : on la traduit
            # en dérive défavorable proportionnelle à la volatilité de la barre.
            bar_range = float(bar["high"]) - float(bar["low"])
            drift = bar_range * (latency_ms / 1000.0) / max(self.exec_tf_ms / 1000.0, 1.0)
            base_price += drift if order.side == "buy" else -drift

        volume_notional = float(bar.get("volume", 0.0) or 0.0) * float(bar["close"])
        cb = self.costs.apply(
            base_price, order.side, order.quantity,
            atr_pct=atr_pct, bar_volume_notional=volume_notional, order_type=order.order_type,
        )
        self.stats["fills"] += 1
        return Fill(
            ts=order.ts, symbol=order.symbol, side=order.side, quantity=order.quantity,
            price=cb.fill_price, fee=cb.fee, slippage_pct=cb.slippage_pct,
            slippage_cost=cb.slippage_cost, latency_ms=latency_ms,
            reference_price=float(bar[reference]),
        )

    # ------------------------------------------------------- sorties intrabar
    def resolve_exit(
        self,
        position,
        bar: pd.Series,
        mark_bar: pd.Series | None,
        bar_ts: pd.Timestamp,
    ) -> ExitEvent | None:
        """Détermine si (et comment) la position sort pendant la barre.

        Priorité : liquidation (mark price) > stop loss > take profit.
        En cas d'ambiguïté SL/TP dans la même barre, on descend en 1m si
        disponible, sinon hypothèse pessimiste.
        """
        side = position.side
        sl = position.stop_loss
        tp = position.take_profit
        liq = position.liquidation_price

        high, low = float(bar["high"]), float(bar["low"])
        mark_high = float(mark_bar["high"]) if mark_bar is not None else high
        mark_low = float(mark_bar["low"]) if mark_bar is not None else low

        if side == "long":
            liq_hit = liq is not None and mark_low <= liq
            sl_hit = sl is not None and low <= sl
            tp_hit = tp is not None and high >= tp
        else:
            liq_hit = liq is not None and mark_high >= liq
            sl_hit = sl is not None and high >= sl
            tp_hit = tp is not None and low <= tp

        if not (liq_hit or sl_hit or tp_hit):
            return None

        # un seul événement touché : pas d'ambiguïté
        touched = [k for k, v in (("liquidation", liq_hit), ("stop_loss", sl_hit), ("take_profit", tp_hit)) if v]
        if len(touched) == 1:
            kind = touched[0]
            price = {"liquidation": liq, "stop_loss": sl, "take_profit": tp}[kind]
            return ExitEvent(kind, self._gap_adjusted(kind, float(price), bar, side), bar_ts, "single_touch")

        self.stats["ambiguous_bars"] += 1

        # --- résolution 1m ---
        if self.resolve_intrabar:
            resolved = self._resolve_with_intrabar(position, bar_ts)
            if resolved is not None:
                self.stats["resolved_intrabar"] += 1
                return resolved

        # --- hypothèse pessimiste : liquidation, puis stop, puis TP ---
        self.stats["resolved_assumption"] += 1
        if liq_hit:
            return ExitEvent("liquidation", self._gap_adjusted("liquidation", float(liq), bar, side),
                             bar_ts, "assumption")
        if sl_hit and self.pessimistic:
            return ExitEvent("stop_loss", self._gap_adjusted("stop_loss", float(sl), bar, side),
                             bar_ts, "assumption")
        if tp_hit:
            return ExitEvent("take_profit", self._gap_adjusted("take_profit", float(tp), bar, side),
                             bar_ts, "assumption")
        return ExitEvent("stop_loss", self._gap_adjusted("stop_loss", float(sl), bar, side),
                         bar_ts, "assumption")

    @staticmethod
    def _gap_adjusted(kind: str, level: float, bar: pd.Series, side: str) -> float:
        """Prix de sortie réel quand la barre **ouvre déjà au-delà** du niveau.

        Supposer qu'un stop est servi à son niveau alors que le marché a gappé
        au travers est l'un des embellissements classiques du backtest : en
        crypto, les gaps de plusieurs pourcents sur ouverture de bougie sont
        fréquents. On sert alors à l'ouverture.
        """
        open_price = float(bar["open"])
        if kind == "take_profit":
            # un gap favorable sert au moins l'objectif
            if side == "long":
                return max(level, open_price) if open_price >= level else level
            return min(level, open_price) if open_price <= level else level
        # stop et liquidation : un gap défavorable dégrade le prix servi
        if side == "long":
            return min(level, open_price)
        return max(level, open_price)

    def _resolve_with_intrabar(self, position, bar_ts: pd.Timestamp) -> ExitEvent | None:
        df = self.intrabar.get(position.symbol)
        if df is None or df.empty:
            return None
        start = to_utc(bar_ts)
        end = start + pd.Timedelta(milliseconds=self.exec_tf_ms)
        window = df.loc[(df.index >= start) & (df.index < end)]
        if window.empty:
            return None
        side = position.side
        sl, tp, liq = position.stop_loss, position.take_profit, position.liquidation_price
        for ts, row in window.iterrows():
            high, low = float(row["high"]), float(row["low"])
            if side == "long":
                if liq is not None and low <= liq:
                    return ExitEvent("liquidation", float(liq), ts, "intrabar")
                if sl is not None and low <= sl:
                    return ExitEvent("stop_loss", float(sl), ts, "intrabar")
                if tp is not None and high >= tp:
                    return ExitEvent("take_profit", float(tp), ts, "intrabar")
            else:
                if liq is not None and high >= liq:
                    return ExitEvent("liquidation", float(liq), ts, "intrabar")
                if sl is not None and high >= sl:
                    return ExitEvent("stop_loss", float(sl), ts, "intrabar")
                if tp is not None and low <= tp:
                    return ExitEvent("take_profit", float(tp), ts, "intrabar")
        return None
