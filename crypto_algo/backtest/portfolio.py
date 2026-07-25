"""Comptabilité du portefeuille : positions en marge isolée, equity, trades.

Convention comptable (marge isolée, collatéral USDT) :

* à l'ouverture : ``cash -= marge + frais`` ; la position détient sa marge ;
* à tout instant : ``equity = cash + Σ(marge_i + PnL_latent_i)`` ;
* funding : réglé en cash toutes les 8h sur le notionnel ;
* à la clôture : ``cash += marge + PnL_réalisé - frais`` ;
* liquidation : la marge isolée est perdue (hypothèse pessimiste configurable).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from ..utils import get_logger, to_utc

log = get_logger("backtest.portfolio")


@dataclass
class Position:
    symbol: str
    side: str                      # "long" | "short"
    quantity: float
    entry_price: float
    margin: float
    leverage: float
    stop_loss: float
    take_profit: float | None
    liquidation_price: float
    opened_at: pd.Timestamp
    risk_amount: float = 0.0
    risk_pct: float = 0.0
    entry_fee: float = 0.0
    funding_paid: float = 0.0
    fees_paid: float = 0.0
    slippage_paid: float = 0.0
    bars_held: int = 0
    regime: str = ""
    families: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def direction(self) -> int:
        return 1 if self.side == "long" else -1

    def notional(self, price: float | None = None) -> float:
        return abs(self.quantity) * float(price if price is not None else self.entry_price)

    def unrealized(self, price: float) -> float:
        return self.direction * (float(price) - self.entry_price) * abs(self.quantity)

    def position_equity(self, price: float) -> float:
        return self.margin + self.unrealized(price)

    def stop_risk(self) -> float:
        """Perte si le stop est touché (hors frais)."""
        return abs(self.entry_price - self.stop_loss) * abs(self.quantity)


@dataclass
class Trade:
    symbol: str
    side: str
    quantity: float
    entry_price: float
    exit_price: float
    opened_at: pd.Timestamp
    closed_at: pd.Timestamp
    gross_pnl: float
    fees: float
    funding: float
    slippage: float
    net_pnl: float
    r_multiple: float
    exit_reason: str
    resolved_with: str
    margin: float
    leverage: float
    risk_amount: float
    bars_held: int
    equity_after: float
    regime: str = ""
    families: str = ""

    @property
    def holding_hours(self) -> float:
        return (to_utc(self.closed_at) - to_utc(self.opened_at)).total_seconds() / 3600.0


class Portfolio:
    def __init__(self, initial_equity: float):
        self.initial_equity = float(initial_equity)
        self.cash = float(initial_equity)
        self.positions: dict[str, Position] = {}
        self.trades: list[Trade] = []
        self.equity_curve: list[tuple[pd.Timestamp, float]] = []
        self.total_fees = 0.0
        self.total_funding = 0.0
        self.total_slippage = 0.0
        self.liquidations = 0

    # ------------------------------------------------------------------ état
    def equity(self, prices: dict[str, float]) -> float:
        total = self.cash
        for symbol, pos in self.positions.items():
            price = prices.get(symbol, pos.entry_price)
            total += pos.position_equity(price)
        return total

    def open_risk(self, equity: float) -> float:
        """Risque agrégé au stop des positions ouvertes, en fraction d'equity."""
        if equity <= 0:
            return 0.0
        return sum(p.stop_risk() for p in self.positions.values()) / equity

    def used_margin(self) -> float:
        return sum(p.margin for p in self.positions.values())

    # -------------------------------------------------------------- opérations
    def open_position(self, pos: Position, fee: float, slippage_cost: float) -> None:
        if pos.symbol in self.positions:
            raise ValueError(f"position déjà ouverte sur {pos.symbol}")
        self.cash -= pos.margin + fee
        pos.entry_fee = fee
        pos.fees_paid += fee
        pos.slippage_paid += slippage_cost
        self.total_fees += fee
        self.total_slippage += slippage_cost
        self.positions[pos.symbol] = pos

    def apply_funding(self, symbol: str, amount: float) -> None:
        pos = self.positions.get(symbol)
        if pos is None:
            return
        self.cash += amount
        pos.funding_paid += amount
        self.total_funding += amount

    def close_position(
        self,
        symbol: str,
        exit_price: float,
        ts: pd.Timestamp,
        fee: float,
        slippage_cost: float,
        reason: str,
        resolved_with: str = "",
        lose_full_margin: bool = False,
        prices: dict[str, float] | None = None,
    ) -> Trade:
        pos = self.positions.pop(symbol)
        gross = pos.unrealized(exit_price)
        position_equity = pos.margin + gross - fee

        if reason == "liquidation":
            self.liquidations += 1
            if lose_full_margin or position_equity < 0:
                position_equity = 0.0
                gross = -pos.margin + fee  # PnL brut équivalent à la perte de marge

        self.cash += max(0.0, position_equity)
        self.total_fees += fee
        self.total_slippage += slippage_cost

        net = gross - fee - pos.entry_fee + pos.funding_paid
        r_multiple = net / pos.risk_amount if pos.risk_amount > 0 else 0.0
        equity_after = self.equity(prices or {})

        trade = Trade(
            symbol=symbol, side=pos.side, quantity=pos.quantity,
            entry_price=pos.entry_price, exit_price=float(exit_price),
            opened_at=pos.opened_at, closed_at=to_utc(ts),
            gross_pnl=gross, fees=fee + pos.entry_fee, funding=pos.funding_paid,
            slippage=pos.slippage_paid + slippage_cost, net_pnl=net, r_multiple=r_multiple,
            exit_reason=reason, resolved_with=resolved_with, margin=pos.margin,
            leverage=pos.leverage, risk_amount=pos.risk_amount, bars_held=pos.bars_held,
            equity_after=equity_after, regime=pos.regime, families=pos.families,
        )
        self.trades.append(trade)
        return trade

    # -------------------------------------------------------------- reporting
    def trades_frame(self) -> pd.DataFrame:
        if not self.trades:
            return pd.DataFrame(
                columns=[
                    "symbol", "side", "quantity", "entry_price", "exit_price", "opened_at",
                    "closed_at", "gross_pnl", "fees", "funding", "slippage", "net_pnl",
                    "r_multiple", "exit_reason", "resolved_with", "margin", "leverage",
                    "risk_amount", "bars_held", "equity_after", "regime", "families",
                    "holding_hours",
                ]
            )
        rows = []
        for t in self.trades:
            d = t.__dict__.copy()
            d["holding_hours"] = t.holding_hours
            rows.append(d)
        return pd.DataFrame(rows)

    def equity_frame(self) -> pd.DataFrame:
        if not self.equity_curve:
            return pd.DataFrame(columns=["equity"])
        idx = pd.DatetimeIndex([t for t, _ in self.equity_curve], name="dt")
        return pd.DataFrame({"equity": [e for _, e in self.equity_curve]}, index=idx)
