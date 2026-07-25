"""Benchmarks (§8.9).

Quatre références, dont un **contrôle négatif** indispensable :

1. ``btc_buy_hold``       — BTC acheté et conservé, sans levier ;
2. ``btc_buy_hold_2x``    — BTC avec levier 2, funding et frais inclus ;
3. ``equal_weight_basket``— panier équipondéré BTC/ETH/SOL rebalancé ;
4. ``random_entries``     — entrées aléatoires avec le **même sizing** que la
   stratégie testée. Si la stratégie ne bat pas ce contrôle, il n'y a rien.

Les benchmarks 1 à 3 sont calculés analytiquement (pas de stops, pas de
routage) mais **avec** les frais d'entrée/sortie et, pour le levier, le coût de
funding : comparer une stratégie nette à un benchmark brut fausse la
comparaison en faveur de la stratégie.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import Config
from ..data.loader import MarketData
from ..execution.costs import FundingModel
from ..utils import get_logger

log = get_logger("validation.benchmarks")


def _price_series(md: MarketData, symbol: str, timeframe: str) -> pd.Series:
    df = md.ohlcv.get((symbol, timeframe))
    if df is None or df.empty:
        return pd.Series(dtype=float)
    return df["close"].astype(float)


def buy_and_hold_equity(
    md: MarketData,
    cfg: Config,
    symbol: str | None = None,
    leverage: float = 1.0,
    initial_equity: float | None = None,
    apply_costs: bool = True,
) -> pd.Series:
    """Equity d'un achat-conservation, éventuellement en levier.

    En levier > 1, le funding est facturé à chaque règlement 8h sur le
    notionnel, et une perte totale (equity <= 0) est absorbante.
    """
    tf = str(cfg.get_path("data.execution_timeframe"))
    symbol = symbol or str(cfg.get_path("universe.benchmark_symbol"))
    equity0 = float(initial_equity if initial_equity is not None else cfg.get_path("risk.initial_equity"))
    price = _price_series(md, symbol, tf)
    if price.empty:
        return pd.Series(dtype=float)

    returns = price.pct_change().fillna(0.0)
    taker = float(cfg.get_path("execution.fees.taker")) if apply_costs else 0.0

    if leverage == 1.0 and not apply_costs:
        return equity0 * (price / price.iloc[0])

    funding_model = FundingModel(cfg, {symbol: md.funding.get(symbol)}) if apply_costs else None
    equity = np.empty(len(price))
    value = equity0 * (1.0 - taker)          # frais d'entrée
    prev_ts = price.index[0]
    for i, (ts, r) in enumerate(returns.items()):
        value *= (1.0 + leverage * r)
        if value <= 0:
            value = 0.0
            equity[i:] = 0.0
            break
        if funding_model is not None and leverage != 0:
            for stamp in funding_model.settlements_between(prev_ts, ts):
                notional = value * abs(leverage)
                value += funding_model.payment(symbol, stamp, "long" if leverage > 0 else "short", notional)
        prev_ts = ts
        equity[i] = value
    equity[-1] *= (1.0 - taker)              # frais de sortie
    return pd.Series(equity, index=price.index, name=f"{symbol}_x{leverage:g}")


def equal_weight_basket_equity(
    md: MarketData,
    cfg: Config,
    symbols: list[str] | None = None,
    initial_equity: float | None = None,
    rebalance: str = "ME",
) -> pd.Series:
    """Panier équipondéré, rebalancé (frais de rebalancement inclus)."""
    tf = str(cfg.get_path("data.execution_timeframe"))
    symbols = symbols or list(cfg.get_path("universe.symbols"))
    equity0 = float(initial_equity if initial_equity is not None else cfg.get_path("risk.initial_equity"))
    taker = float(cfg.get_path("execution.fees.taker"))

    prices = pd.DataFrame({s: _price_series(md, s, tf) for s in symbols}).dropna(how="all")
    if prices.empty:
        return pd.Series(dtype=float)
    prices = prices.ffill()
    returns = prices.pct_change().fillna(0.0)

    freq = "W" if str(rebalance).upper().startswith("W") else "M"
    naive = returns.index.tz_convert("UTC").tz_localize(None)
    periods = pd.PeriodIndex(naive, freq=freq).to_numpy()
    weights = pd.Series(1.0 / prices.notna().sum(axis=1).replace(0, np.nan), index=prices.index)

    equity = np.empty(len(returns))
    value = equity0 * (1.0 - taker)
    current_period = periods[0]
    for i, ts in enumerate(returns.index):
        available = returns.iloc[i][prices.iloc[i].notna()]
        step = float(available.mean()) if len(available) else 0.0
        value *= (1.0 + step)
        if periods[i] != current_period:      # rebalancement : coût de rotation
            value *= (1.0 - taker)
            current_period = periods[i]
        equity[i] = value
    return pd.Series(equity, index=returns.index, name="equal_weight_basket")


def random_control_equity(
    md: MarketData,
    cfg: Config,
    seed: int = 4242,
    entry_probability: float = 0.02,
    cost_stress: float = 1.0,
) -> tuple[pd.Series, pd.DataFrame]:
    """Contrôle négatif : mêmes moteur, mêmes coûts, mêmes règles de risque,
    mais des entrées tirées au hasard."""
    from ..backtest.engine import BacktestEngine
    from ..strategies.trivial import RandomEntryStrategy

    strategy = RandomEntryStrategy(cfg, entry_probability=entry_probability, seed=seed)
    result = BacktestEngine(cfg, md, strategy, cost_stress=cost_stress, seed=seed).run()
    return result.equity["equity"], result.trades


def build_benchmarks(
    md: MarketData,
    cfg: Config,
    include: list[str] | None = None,
    initial_equity: float | None = None,
) -> dict[str, pd.Series]:
    include = include or list(cfg.get_path("validation.benchmarks"))
    bench_symbol = str(cfg.get_path("universe.benchmark_symbol"))
    out: dict[str, pd.Series] = {}
    for name in include:
        try:
            if name == "btc_buy_hold":
                out[name] = buy_and_hold_equity(md, cfg, bench_symbol, 1.0, initial_equity)
            elif name == "btc_buy_hold_2x":
                out[name] = buy_and_hold_equity(md, cfg, bench_symbol, 2.0, initial_equity)
            elif name == "equal_weight_basket":
                out[name] = equal_weight_basket_equity(md, cfg, initial_equity=initial_equity)
            elif name == "random_entries":
                equity, _ = random_control_equity(md, cfg)
                out[name] = equity
            else:
                log.warning("benchmark inconnu : %s", name)
        except Exception as exc:  # noqa: BLE001
            log.warning("benchmark %s indisponible : %s", name, exc)
    return out
