"""Event-driven bar-by-bar backtest engine with realistic, pessimistic fills.

Execution model (deliberately conservative):
- A signal computed on bar t is executed at the OPEN of bar t+1 (no lookahead).
- Entries/exits pay half-spread + slippage adversely; commissions per side.
- On the entry bar and any later bar, if both SL and TP lie within the bar's
  range, the STOP is assumed to be hit first (pessimistic intrabar rule).
- If price gaps through the SL/TP at the open, the fill happens at the open
  (worse than the level for stops), not at the level.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from quantbt.config import CostConfig, RiskConfig
from quantbt.data.loader import MarketData
from quantbt.engine import costs as C
from quantbt.engine.sizing import position_size
from quantbt.strategy.base import Strategy

TRADE_COLUMNS = [
    "entry_time", "exit_time", "side", "qty", "entry", "exit",
    "sl", "tp", "pnl", "r_multiple", "return_pct", "bars_held", "reason",
]


@dataclass
class BacktestResult:
    equity: pd.Series
    trades: pd.DataFrame
    initial_capital: float
    bars_per_day: float
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def returns(self) -> pd.Series:
        return self.equity.pct_change().fillna(0.0)

    @property
    def exposure(self) -> float:
        n = len(self.equity)
        return float(self.trades["bars_held"].sum() / n) if n and len(self.trades) else 0.0


def _bars_per_day(index: pd.DatetimeIndex) -> float:
    if len(index) < 2:
        return 1.0
    step = np.median(np.diff(index.view("i8"))) / 1e9  # seconds
    return 86400.0 / step if step > 0 else 1.0


def run_backtest(
    data: MarketData,
    strategy: Strategy,
    cost_cfg: CostConfig,
    risk_cfg: RiskConfig,
) -> BacktestResult:
    df = data.frame
    signals = strategy.generate_signals(data)

    o = df["open"].to_numpy(float)
    h = df["high"].to_numpy(float)
    lo = df["low"].to_numpy(float)
    c = df["close"].to_numpy(float)
    sig = signals["signal"].to_numpy(int)
    sig_sl = signals["sl"].to_numpy(float)
    sig_tp = signals["tp"].to_numpy(float)
    n = len(df)
    bpd = _bars_per_day(df.index)

    cash = risk_cfg.initial_capital
    equity = np.empty(n)
    trades: list[dict[str, Any]] = []

    pos_side = 0  # +1 long, -1 short, 0 flat
    qty = 0.0
    entry_px = 0.0
    sl = tp = 0.0
    entry_i = -1
    planned_risk = 0.0
    entry_comm = 0.0

    def close_position(i: int, raw_px: float, reason: str) -> None:
        nonlocal cash, pos_side, qty
        exit_px = C.fill_price(raw_px, -pos_side, cost_cfg)
        gross = pos_side * qty * (exit_px - entry_px)
        fees = C.commission(qty * exit_px, cost_cfg)
        funding = C.funding_cost(qty * entry_px, i - entry_i, bpd, cost_cfg)
        cash += gross - fees - funding
        # Entry commission was already taken from cash at entry time; the
        # trade's pnl reports the all-in result including it.
        pnl = gross - fees - funding - entry_comm
        trades.append(
            {
                "entry_time": df.index[entry_i],
                "exit_time": df.index[i],
                "side": pos_side,
                "qty": qty,
                "entry": entry_px,
                "exit": exit_px,
                "sl": sl,
                "tp": tp,
                "pnl": pnl,
                "r_multiple": pnl / planned_risk if planned_risk > 0 else 0.0,
                "return_pct": pnl / equity[entry_i - 1] if entry_i > 0 else 0.0,
                "bars_held": i - entry_i,
                "reason": reason,
            }
        )
        pos_side = 0
        qty = 0.0

    def check_intrabar_exit(i: int) -> None:
        """Pessimistic SL-first check of bar i against current SL/TP."""
        if pos_side == 0:
            return
        if pos_side == 1:
            if lo[i] <= sl:
                close_position(i, min(o[i], sl), "sl")
            elif h[i] >= tp:
                close_position(i, max(o[i], tp), "tp")
        else:
            if h[i] >= sl:
                close_position(i, max(o[i], sl), "sl")
            elif lo[i] <= tp:
                close_position(i, min(o[i], tp), "tp")

    for i in range(n):
        if i > 0:
            prev_sig = sig[i - 1]
            # Exit on opposite signal at the open, before SL/TP checks.
            if pos_side != 0 and prev_sig != 0 and prev_sig != pos_side:
                close_position(i, o[i], "reverse")
            check_intrabar_exit(i)

            if pos_side == 0 and prev_sig != 0 and not np.isnan(sig_sl[i - 1]):
                side = int(prev_sig)
                eq_now = cash
                raw_entry = o[i]
                epx = C.fill_price(raw_entry, side, cost_cfg)
                s_sl, s_tp = sig_sl[i - 1], sig_tp[i - 1]
                # Entry must still make sense after the gap to the open.
                valid = (side == 1 and s_sl < epx < s_tp) or (side == -1 and s_tp < epx < s_sl)
                if valid:
                    rr = abs(s_tp - epx) / abs(epx - s_sl)
                    if rr >= risk_cfg.min_rr:
                        q = position_size(eq_now, epx, s_sl, risk_cfg)
                        if q > 0:
                            pos_side, qty = side, q
                            entry_px, sl, tp = epx, s_sl, s_tp
                            entry_i = i
                            planned_risk = q * abs(epx - s_sl)
                            entry_comm = C.commission(q * epx, cost_cfg)
                            cash -= entry_comm
                            check_intrabar_exit(i)  # entry bar can hit SL/TP

        equity[i] = cash + (pos_side * qty * (c[i] - entry_px) if pos_side != 0 else 0.0)

    if pos_side != 0:
        close_position(n - 1, c[-1], "end")
        equity[-1] = cash

    eq = pd.Series(equity, index=df.index, name="equity")
    tdf = pd.DataFrame(trades, columns=TRADE_COLUMNS)
    return BacktestResult(
        equity=eq,
        trades=tdf,
        initial_capital=risk_cfg.initial_capital,
        bars_per_day=bpd,
        meta={"strategy": strategy.name, "params": dict(strategy.params)},
    )
