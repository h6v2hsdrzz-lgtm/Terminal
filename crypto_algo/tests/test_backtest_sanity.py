"""Validation de la **mécanique** du moteur sur des stratégies triviales (§10.2).

« Si le backtest fait gagner de l'argent à une stratégie aléatoire, le moteur
est faux. » Ces tests sont donc la porte d'entrée de toute la suite : tant
qu'ils ne passent pas, aucun signal ne mérite d'être écrit.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from crypto_algo.backtest.engine import BacktestEngine
from crypto_algo.config import load_config
from crypto_algo.data.loader import synthetic_market_data
from crypto_algo.strategies.trivial import AlwaysFlatStrategy, BuyAndHoldStrategy, RandomEntryStrategy


def make_cfg(**overrides):
    base = {
        "universe.symbols": ["BTC/USDT:USDT"],
        "backtest.warmup_bars": 50,
        "backtest.auto_warmup": False,
        "risk.initial_equity": 10_000.0,
        "data.execution_timeframe": "15m",
        "data.intrabar_timeframe": "5m",
        "execution.rejects.enabled": False,
    }
    base.update(overrides)
    return load_config(overrides=base)


def make_md(n_bars=4000, seed=5, regime="random_walk", funding_rate=0.0001):
    return synthetic_market_data(
        symbols=["BTC/USDT:USDT"], timeframes=["15m"], n_bars=n_bars,
        exec_timeframe="15m", seed=seed, regime=regime, funding_rate=funding_rate,
    )


# --------------------------------------------------------------- flat = neutre
def test_always_flat_keeps_equity_exactly_constant():
    res = BacktestEngine(make_cfg(), make_md(), AlwaysFlatStrategy()).run()
    assert res.equity["equity"].nunique() == 1
    assert res.final_equity == pytest.approx(10_000.0)
    assert len(res.trades) == 0


# ------------------------------------------- contrôle négatif : entrées au hasard
@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_random_strategy_loses_money(seed):
    """Espérance brute nulle, espérance nette négative : c'est le coût du réel."""
    cfg = make_cfg()
    md = make_md(n_bars=6000, seed=seed)
    res = BacktestEngine(cfg, md, RandomEntryStrategy(cfg, entry_probability=0.02, seed=seed)).run()
    assert len(res.trades) >= 20, "échantillon insuffisant pour conclure"
    assert res.final_equity < 10_000.0, f"seed={seed} : le moteur fabrique de l'argent"


def test_random_strategy_loss_grows_with_costs():
    """Le stress des coûts doit dégrader le résultat de façon monotone."""
    cfg = make_cfg()
    md = make_md(n_bars=6000, seed=7)
    results = []
    for stress in (1.0, 1.5, 2.0):
        res = BacktestEngine(
            cfg, md, RandomEntryStrategy(cfg, entry_probability=0.02, seed=7), cost_stress=stress
        ).run()
        results.append(res.final_equity)
    assert results[0] > results[1] > results[2]


def test_gross_pnl_of_random_strategy_is_near_zero_before_costs():
    """Contrôle du modèle de coûts : le brut d'une stratégie aléatoire doit être
    petit devant la perte nette, sinon les coûts masquent une erreur de signe."""
    cfg = make_cfg()
    md = make_md(n_bars=8000, seed=11)
    res = BacktestEngine(cfg, md, RandomEntryStrategy(cfg, entry_probability=0.02, seed=11)).run()
    gross = res.trades["gross_pnl"].sum()
    costs = res.trades["fees"].sum() - res.trades["funding"].sum()
    assert costs > 0
    assert abs(gross) < 6 * costs


# ------------------------------------------------------- identité comptable
def test_accounting_identity_holds():
    """equity finale = equity initiale + somme des PnL nets des trades."""
    cfg = make_cfg()
    md = make_md(n_bars=5000, seed=13)
    res = BacktestEngine(cfg, md, RandomEntryStrategy(cfg, entry_probability=0.02, seed=13)).run()
    net = res.trades["net_pnl"].sum()
    assert res.final_equity == pytest.approx(10_000.0 + net, rel=1e-6, abs=1e-6)


def test_cash_never_goes_negative():
    cfg = make_cfg()
    md = make_md(n_bars=5000, seed=17)
    engine = BacktestEngine(cfg, md, RandomEntryStrategy(cfg, entry_probability=0.05, seed=17))
    engine.run()
    assert engine.portfolio.cash >= -1e-9


def test_equity_never_negative_and_no_invariant_violation():
    cfg = make_cfg()
    md = make_md(n_bars=8000, seed=19, regime="trend")
    res = BacktestEngine(cfg, md, RandomEntryStrategy(cfg, entry_probability=0.05, seed=19)).run()
    assert (res.equity["equity"] >= 0).all()


# ----------------------------------------------------- buy & hold cohérent
def test_buy_and_hold_direction_matches_the_market():
    """Sur une série haussière, le buy & hold en levier doit gagner ; sur une
    série baissière, perdre. Sinon un signe est inversé quelque part."""
    cfg = make_cfg(**{"risk.max_holding_days": 3650.0})
    up = make_md(n_bars=3000, seed=2, regime="trend")
    res_up = BacktestEngine(cfg, up, BuyAndHoldStrategy(cfg)).run()
    price_change = (
        up.get("BTC/USDT:USDT", "15m")["close"].iloc[-1]
        / up.get("BTC/USDT:USDT", "15m")["close"].iloc[0] - 1
    )
    assert price_change > 0
    assert res_up.final_equity > 10_000.0


# ---------------------------------------------------------- coûts appliqués
def test_fees_and_funding_are_actually_charged():
    cfg = make_cfg()
    md = make_md(n_bars=6000, seed=23, funding_rate=0.0005)
    res = BacktestEngine(cfg, md, RandomEntryStrategy(cfg, entry_probability=0.02, seed=23)).run()
    assert res.stats["total_fees"] > 0
    assert res.stats["total_funding"] != 0
    assert res.stats["total_slippage"] > 0


def test_zero_cost_engine_is_a_fair_game():
    """Sans frais, sans slippage, sans funding, une stratégie aléatoire doit
    osciller autour de zéro : c'est le contrôle que le moteur lui-même est
    neutre (et non pas biaisé positivement ou négativement)."""
    cfg = make_cfg(
        **{
            "execution.fees.taker": 0.0,
            "execution.fees.maker": 0.0,
            "execution.slippage.spread_bps": 0.0,
            "execution.slippage.vol_coefficient": 0.0,
            "execution.slippage.impact_coefficient": 0.0,
            "execution.funding.enabled": False,
            "execution.latency.enabled": False,
        }
    )
    outcomes = []
    for seed in range(1, 13):
        md = make_md(n_bars=4000, seed=seed)
        res = BacktestEngine(cfg, md, RandomEntryStrategy(cfg, entry_probability=0.02, seed=seed)).run()
        outcomes.append(res.final_equity - 10_000.0)
    wins = sum(1 for o in outcomes if o > 0)
    assert 2 <= wins <= 10, f"jeu non équitable : {wins}/12 tirages gagnants"
    assert abs(np.mean(outcomes)) < 0.05 * 10_000.0


# --------------------------------------------------- coupe-circuits en situation
def test_daily_drawdown_stop_flattens_and_blocks_reentry():
    """Scénario synthétique : effondrement brutal -> halte, plus aucun trade
    jusqu'à minuit UTC."""
    from crypto_algo.tests.conftest import make_bars, market_from_bars
    from crypto_algo.tests.test_execution import ScriptedStrategy

    # Scénario : le marché ouvre régulièrement **au travers** du stop (gaps de
    # -9 %). Chaque gap coûte donc bien plus que 1,5 % d'equity, et le cumul
    # doit déclencher le coupe-circuit journalier.
    n = 120
    prices = []
    price = 100.0
    for i in range(n):
        if i % 12 == 6:
            price *= 0.91                      # gap à l'ouverture, à travers le stop
            prices.append((price, price * 1.001, price * 0.999, price))
        else:
            price *= 1.004                     # récupération lente
            prices.append((price, price * 1.002, price * 0.998, price))
    bars = make_bars(prices, timeframe_ms=900_000, start_ms=1_704_067_200_000)
    md = market_from_bars(bars, timeframe="15m")
    cfg = make_cfg(**{"execution.latency.enabled": False})
    strat = ScriptedStrategy([1.0] * n, [p[0] * 0.97 for p in prices])
    engine = BacktestEngine(cfg, md, strat)
    res = engine.run()
    halts = res.risk_events[res.risk_events["kind"] == "halt"]
    assert not halts.empty, "le coupe-circuit journalier ne s'est pas déclenché"
    first_halt = pd.Timestamp(halts["ts"].iloc[0])
    after = res.trades[pd.to_datetime(res.trades["opened_at"]) > first_halt]
    same_day = after[pd.to_datetime(after["opened_at"]) < first_halt.normalize() + pd.Timedelta(days=1)]
    assert same_day.empty, "des positions ont été ouvertes malgré la halte"


def test_kill_switch_stops_the_backtest_definitively():
    """Scénario synthétique : effondrement continu jusqu'à -60 % du HWM.

    Le kill switch doit se déclencher, enregistrer sa date, et **aucun** trade
    ne doit être ouvert ensuite — même des semaines plus tard.
    """
    from crypto_algo.tests.conftest import make_bars, market_from_bars
    from crypto_algo.tests.test_execution import ScriptedStrategy

    # Il faut plusieurs mois : le coupe-circuit mensuel plafonne la perte à
    # -25 % par mois, donc atteindre -60 % du high-water mark demande au moins
    # quatre mois de pertes (0,75^4 = -68 %). Une chute violente sur quelques
    # jours ne déclenche *pas* le kill switch — c'est le comportement voulu.
    n = 12_000                                     # ~125 jours en 15m
    prices, price = [], 100.0
    for i in range(n):
        price *= 0.93 if i % 8 == 4 else 1.004     # gaps répétés à travers le stop
        prices.append((price, price * 1.001, price * 0.999, price))
    bars = make_bars(prices, timeframe_ms=900_000, start_ms=1_704_067_200_000)
    md = market_from_bars(bars, timeframe="15m")
    cfg = make_cfg(**{"execution.latency.enabled": False})
    engine = BacktestEngine(cfg, md, ScriptedStrategy([1.0] * n, [p[0] * 0.97 for p in prices]))
    res = engine.run()

    assert engine.risk.killed, "le kill switch ne s'est pas déclenché"
    assert res.stats["killed_at"] is not None
    killed_at = pd.Timestamp(res.stats["killed_at"])
    after = res.trades[pd.to_datetime(res.trades["opened_at"]) > killed_at]
    assert after.empty, "des positions ont été ouvertes après le kill switch"
    # l'arrêt est définitif : l'equity ne bouge plus après la dernière clôture
    tail = res.equity.loc[res.equity.index > killed_at + pd.Timedelta(hours=2), "equity"]
    assert tail.nunique() <= 1, "l'equity varie encore après l'arrêt définitif"
