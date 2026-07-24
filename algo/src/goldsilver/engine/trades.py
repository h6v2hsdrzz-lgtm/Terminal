"""Structures de données des positions et trades exécutés."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

TRADE_COLUMNS = [
    "asset", "side", "entry_time", "exit_time", "entry", "exit", "units",
    "sl", "tp", "pnl", "pnl_pct", "r_multiple", "reason", "bars_held",
    "swap_paid", "risk_amount",
]


@dataclass
class Position:
    asset: str
    side: int                  # +1 long, -1 short
    units: float
    entry: float               # prix d'exécution (spread/slippage inclus)
    sl: float
    tp: float
    entry_time: pd.Timestamp
    risk_amount: float         # $ risqués à l'entrée (units x sl_dist x contract_size)
    sl_dist: float
    bars_held: int = 0
    swap_paid: float = 0.0


@dataclass
class Trade:
    asset: str
    side: int
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    entry: float
    exit: float
    units: float
    sl: float
    tp: float
    pnl: float                 # $ net (spread + slippage via les prix, swap inclus)
    pnl_pct: float             # pnl / equity à l'entrée
    r_multiple: float          # pnl / risque initial
    reason: str                # "tp" | "sl" | "time" | "end"
    bars_held: int
    swap_paid: float
    risk_amount: float

    @staticmethod
    def to_frame(trades: list["Trade"]) -> pd.DataFrame:
        if not trades:
            return pd.DataFrame(columns=TRADE_COLUMNS)
        df = pd.DataFrame([t.__dict__ for t in trades])
        return df[TRADE_COLUMNS]
