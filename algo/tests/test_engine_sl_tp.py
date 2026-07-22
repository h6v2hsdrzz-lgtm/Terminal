"""Gestion SL/TP du moteur : cas nominaux, worst-case intrabar, gaps, swap.

Tous les scénarios sont calculés À LA MAIN et vérifiés au dollar près.
Convention des fixtures : risque 1 % de 10 000 $ = 100 $, sl_dist = 5 $
-> 20 unités ; tp_dist = 15 $ (R:R 1:3).
"""

from __future__ import annotations

import math

import pytest

from goldsilver.engine.backtester import Backtester
from tests.conftest import make_bars

FLAT = (100.0, 100.5, 99.5, 100.0)


@pytest.fixture
def bt(make_cfg):
    return Backtester(make_cfg())


def test_long_tp_exact(bt) -> None:
    bars = make_bars(
        [FLAT, (100, 101, 99, 100), (100, 116, 99, 110), FLAT],
        signal=[1, 0, 0, 0],
    )
    res = bt.run({"XAUUSD": bars})
    assert len(res.trades) == 1
    t = res.trades[0]
    # entrée à l'open de la bougie 1 (spread 0, slippage 0), TP 100+15 touché
    assert t.entry == 100.0 and t.exit == 115.0 and t.reason == "tp"
    assert t.units == 20.0
    assert math.isclose(t.pnl, 300.0)
    assert math.isclose(t.r_multiple, 3.0)
    assert math.isclose(res.equity.iloc[-1], 10_300.0)


def test_long_sl_exact(bt) -> None:
    bars = make_bars(
        [FLAT, (100, 101, 99, 100), (100, 101, 94.9, 96), FLAT],
        signal=[1, 0, 0, 0],
    )
    res = bt.run({"XAUUSD": bars})
    t = res.trades[0]
    assert t.exit == 95.0 and t.reason == "sl"
    assert math.isclose(t.pnl, -100.0)          # exactement le risque
    assert math.isclose(t.r_multiple, -1.0)
    assert math.isclose(res.equity.iloc[-1], 9_900.0)


def test_worst_case_both_hit_takes_sl(bt) -> None:
    bars = make_bars(
        [FLAT, (100, 101, 99, 100), (100, 120, 90, 110), FLAT],
        signal=[1, 0, 0, 0],
    )
    res = bt.run({"XAUUSD": bars})
    assert res.trades[0].reason == "sl"
    assert math.isclose(res.trades[0].pnl, -100.0)


def test_optimistic_both_hit_takes_tp(make_cfg) -> None:
    bt = Backtester(make_cfg(engine={"intrabar_worst_case": False}))
    bars = make_bars(
        [FLAT, (100, 101, 99, 100), (100, 120, 90, 110), FLAT],
        signal=[1, 0, 0, 0],
    )
    res = bt.run({"XAUUSD": bars})
    assert res.trades[0].reason == "tp"


def test_gap_through_sl_fills_at_open(bt) -> None:
    # ouverture à 90, sous le SL de 95 : exécution à 90, PERTE > 1R (réaliste)
    bars = make_bars(
        [FLAT, (100, 101, 99, 100), (90, 92, 89, 91), FLAT],
        signal=[1, 0, 0, 0],
    )
    res = bt.run({"XAUUSD": bars})
    t = res.trades[0]
    assert t.exit == 90.0 and t.reason == "sl"
    assert math.isclose(t.pnl, -200.0)
    assert math.isclose(t.r_multiple, -2.0)


def test_short_with_spread_and_slippage(make_cfg) -> None:
    cfg = make_cfg(engine={"costs": {"per_asset": {
        "XAUUSD": {"fixed_spread": 0.2, "slippage": 0.1,
                    "swap_long": 0.0, "swap_short": 0.0}}}})
    bt = Backtester(cfg)
    # short : entrée au bid open - slippage = 99.9 ; SL = 104.9, TP = 84.9.
    # Bougie 2 : high 104.8 -> ask high = 105.0 >= SL -> stop exécuté
    # à SL + slippage = 105.0.
    bars = make_bars(
        [FLAT, (100, 104.8, 99, 100), FLAT, FLAT],
        signal=[-1, 0, 0, 0],
    )
    res = bt.run({"XAUUSD": bars})
    t = res.trades[0]
    assert t.side == -1
    assert math.isclose(t.entry, 99.9)
    assert t.reason == "sl"
    assert math.isclose(t.exit, 105.0)
    # sizing : 100 $ / 5 $ = 20 unités ; pnl = 20 x (99.9 - 105.0)
    assert math.isclose(t.pnl, 20 * (99.9 - 105.0))


def test_short_tp_at_limit_price(make_cfg) -> None:
    cfg = make_cfg(engine={"costs": {"per_asset": {
        "XAUUSD": {"fixed_spread": 0.2, "slippage": 0.1,
                    "swap_long": 0.0, "swap_short": 0.0}}}})
    bt = Backtester(cfg)
    # entrée 99.9, TP = 84.9 ; il faut ask low = low + 0.2 <= 84.9, soit low <= 84.7
    bars = make_bars(
        [FLAT, (100, 101, 84.6, 90), FLAT, FLAT],
        signal=[-1, 0, 0, 0],
    )
    res = bt.run({"XAUUSD": bars})
    t = res.trades[0]
    assert t.reason == "tp"
    assert math.isclose(t.exit, 84.9)           # limite : jamais mieux que le TP
    assert math.isclose(t.pnl, 20 * (99.9 - 84.9))


def test_time_stop_exits_at_close(make_cfg) -> None:
    bt = Backtester(make_cfg())
    bars = make_bars([FLAT] + [(100, 100.5, 99.5, 100.0)] * 6, signal=[1, 0, 0, 0, 0, 0, 0])
    res = bt.run({"XAUUSD": bars}, max_bars_held=3)
    t = res.trades[0]
    assert t.reason == "time"
    assert t.bars_held == 3
    assert t.exit == 100.0                       # clôture, slippage 0


def test_entry_pays_spread_and_slippage(make_cfg) -> None:
    cfg = make_cfg(engine={"costs": {"per_asset": {
        "XAUUSD": {"fixed_spread": 0.3, "slippage": 0.1,
                    "swap_long": 0.0, "swap_short": 0.0}}}})
    bt = Backtester(cfg)
    bars = make_bars([FLAT, FLAT, FLAT], signal=[1, 0, 0])
    res = bt.run({"XAUUSD": bars})
    t = res.trades[0]
    assert math.isclose(t.entry, 100.0 + 0.3 + 0.1)  # ask + slippage


def test_swap_charged_at_rollover_triple_wednesday(make_cfg) -> None:
    cfg = make_cfg(engine={"costs": {"per_asset": {
        "XAUUSD": {"fixed_spread": 0.0, "slippage": 0.0,
                    "swap_long": -1.0, "swap_short": 0.0}}}})
    bt = Backtester(cfg)
    # départ mardi 2024-01-02 19:00 UTC ; entrée à 20:00 ; bougies 21:00 mardi
    # (x1) et 21:00 mercredi (x3) traversées -> swap = 20 u x (-1) x 4 = -80 $.
    n = 27
    bars = make_bars([FLAT] * n, start="2024-01-02 19:00", signal=[1] + [0] * (n - 1))
    res = bt.run({"XAUUSD": bars}, max_bars_held=n - 2)
    t = res.trades[0]
    assert math.isclose(t.swap_paid, -80.0)
    assert math.isclose(res.equity.iloc[-1], 10_000.0 + t.pnl)


def test_no_reentry_same_bar_after_exit(bt) -> None:
    # sortie SL sur la bougie 2 qui porte aussi un signal -> la ré-entrée ne
    # peut se faire qu'à la bougie 3 au plus tôt (ici : signal bougie 2 -> entrée bougie 3)
    bars = make_bars(
        [FLAT, (100, 101, 99, 100), (100, 101, 94, 96, ), (96, 97, 95, 96), FLAT],
        signal=[1, 0, 1, 0, 0],
    )
    res = bt.run({"XAUUSD": bars})
    assert len(res.trades) == 2
    assert res.trades[0].reason == "sl"
    assert res.trades[1].entry_time == bars.index[3]


def test_correlated_second_position_risks_half(make_cfg) -> None:
    cfg = make_cfg()
    bt = Backtester(cfg)
    xau = make_bars([FLAT] * 5, signal=[1, 0, 0, 0, 0])
    xag = make_bars([FLAT] * 5, signal=[0, 1, 0, 0, 0])
    res = bt.run({"XAUUSD": xau, "XAGUSD": xag})
    by_asset = {t.asset: t for t in res.trades}
    assert by_asset["XAUUSD"].units == 20.0          # risque plein : 100 $
    assert by_asset["XAGUSD"].units == 10.0          # corrélé même sens : 50 $


def test_open_position_marked_to_market(bt) -> None:
    bars = make_bars(
        [FLAT, (100, 101, 99, 100), (100, 110, 99, 108), (108, 112, 107, 110)],
        signal=[1, 0, 0, 0],
    )
    res = bt.run({"XAUUSD": bars})
    # position encore ouverte à la bougie 2 : equity = 10 000 + 20 x (108 - 100)
    assert math.isclose(res.equity.iloc[2], 10_160.0)
    # clôture forcée en fin de données au dernier close
    assert res.trades[-1].reason == "end"
    assert math.isclose(res.equity.iloc[-1], 10_000.0 + 20 * (110 - 100))
