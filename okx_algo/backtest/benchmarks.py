"""Benchmarks du mandat (§1) : BTC buy & hold, panier equipondere, BTC x2.

Le BTC x2 n'est pas « deux fois la courbe BTC » : une exposition levier x2 sur
perpetuel doit etre rebalancee, paie le funding sur la totalite du notionnel et
subit le drag de volatilite du compose. Il est donc simule reellement, sinon la
comparaison flatterait la strategie.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..data.panel import Panel


def btc_hold(panel: Panel, initial_equity: float, symbol: str = "BTC-USDT-SWAP",
             i0: int = 0, i1: int | None = None) -> pd.Series:
    i1 = panel.n if i1 is None else i1
    px = panel.data[symbol].close[i0:i1].astype(float)
    px = pd.Series(px, index=panel.index[i0:i1]).ffill()
    return (initial_equity * px / px.dropna().iloc[0]).rename("btc_hold")


def equal_weight_basket(panel: Panel, initial_equity: float, i0: int = 0,
                        i1: int | None = None, rebalance: str = "MS") -> pd.Series:
    """Panier equipondere, rebalance mensuellement, actifs inclus des leur cotation."""
    i1 = panel.n if i1 is None else i1
    idx = panel.index[i0:i1]
    rets = {}
    for s in panel.symbols:
        c = pd.Series(panel.data[s].close[i0:i1].astype(float), index=idx).ffill()
        rets[s] = c.pct_change()
    R = pd.DataFrame(rets).fillna(0.0)
    live = pd.DataFrame({s: np.isfinite(panel.data[s].close[i0:i1]) for s in panel.symbols},
                        index=idx)
    naive = idx.tz_localize(None) if idx.tz is not None else idx
    groups = naive.to_period("M") if rebalance == "MS" else naive.to_period("D")

    equity = np.empty(len(idx))
    eq = initial_equity
    w = None
    last_group = None
    for t in range(len(idx)):
        active = live.iloc[t].to_numpy()
        if w is None or groups[t] != last_group:
            n = max(int(active.sum()), 1)
            w = np.where(active, 1.0 / n, 0.0)
            last_group = groups[t]
        eq *= 1.0 + float(np.nansum(w * R.iloc[t].to_numpy()))
        equity[t] = eq
    return pd.Series(equity, index=idx, name="equal_weight_basket")


def btc_leveraged(panel: Panel, initial_equity: float, leverage: float = 2.0,
                  symbol: str = "BTC-USDT-SWAP", i0: int = 0, i1: int | None = None,
                  taker_fee: float = 0.0005, rebalance_hours: int = 24,
                  bars_per_hour: float = 4.0) -> pd.Series:
    """Exposition levier constante sur perpetuel : funding et rebalancement inclus."""
    i1 = panel.n if i1 is None else i1
    idx = panel.index[i0:i1]
    d = panel.data[symbol]
    c = pd.Series(d.close[i0:i1].astype(float), index=idx).ffill()
    r = c.pct_change().fillna(0.0).to_numpy()
    fund = np.nan_to_num(d.funding[i0:i1])
    step = max(1, int(rebalance_hours * bars_per_hour))

    equity = np.empty(len(idx))
    eq = initial_equity
    for t in range(len(idx)):
        eq *= 1.0 + leverage * r[t]
        if fund[t] != 0.0:
            eq -= eq * leverage * fund[t]          # le long paie quand le taux > 0
        if t % step == 0 and t > 0:
            # remise a l'exposition cible : cout d'un ajustement de notionnel
            eq -= eq * abs(leverage - 1.0) * taker_fee * 0.1
        equity[t] = max(eq, 0.0)
        if eq <= 0:
            equity[t:] = 0.0
            break
    return pd.Series(equity, index=idx, name=f"btc_{leverage:g}x")


def build_all(panel: Panel, initial_equity: float, i0: int = 0,
              i1: int | None = None, bars_per_hour: float = 4.0) -> pd.DataFrame:
    return pd.concat([
        btc_hold(panel, initial_equity, i0=i0, i1=i1),
        equal_weight_basket(panel, initial_equity, i0=i0, i1=i1),
        btc_leveraged(panel, initial_equity, 2.0, i0=i0, i1=i1,
                      bars_per_hour=bars_per_hour),
    ], axis=1)
