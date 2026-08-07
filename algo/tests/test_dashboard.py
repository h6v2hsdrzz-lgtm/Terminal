"""Tests du dashboard : couche de données, routes HTTP, export autonome.

Aucun réseau : ``enable_broker=False`` force le mode hors-ligne, qui doit
rester pleinement fonctionnel (c'est la garantie principale du module).
"""

from __future__ import annotations

import json
import threading
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
import yaml

from goldsilver.config import load_config
from goldsilver.dashboard.build_cache import _apply_live_risk
from goldsilver.dashboard.data import DashboardData
from goldsilver.dashboard.export import export_html
from goldsilver.dashboard.server import _Handler
from goldsilver.live.risk import HARD_MAX_RISK_PCT

STRATEGY_CFG: dict[str, Any] = {
    "seed": 42,
    "data": {
        "base_timeframe": "1h", "timeframes": ["1h", "4h"], "start": None,
        "end": None, "session_day_offset_hours": -2, "warmup_days": 30,
        "assets": {
            "XAUUSD": {"csv": "data/raw/XAUUSD_1h.csv", "contract_size": 1.0,
                       "min_size": 1.0, "size_step": 1.0, "max_leverage": 20.0},
        },
    },
    "fetch": {"source": "dukascopy", "symbols": ["XAUUSD"], "start": "2024-01-01",
              "end": None, "out_dir": "data/raw", "price_scale": 1000.0,
              "pause_seconds": 0.0},
    "strategy": {
        "name": "daily_breakout",
        "params": {"trend_timeframe": "4h", "donchian_n": 10, "trend_ema": 20,
                   "atr_period": 14, "sl_atr_mult": 2.5, "tp_rr": 3.0,
                   "max_bars_held": 240, "direction": "long"},
    },
    "engine": {
        "initial_equity": 10000.0, "risk_pct": 0.0075, "max_open_risk_pct": 0.015,
        "corr_risk_factor": 0.5, "max_leverage": 20.0, "intrabar_worst_case": True,
        "costs": {
            "spread_mode": "fixed", "pessimistic_spread_mult": 1.0,
            "rollover_hour_utc": 21, "triple_swap_weekday": 2,
            "per_asset": {"XAUUSD": {"fixed_spread": 0.3, "slippage": 0.1,
                                     "swap_long": 0.0, "swap_short": 0.0}},
        },
    },
    "validation": {
        "objective": "sharpe", "min_trades": 5, "grid": {"donchian_n": [10]},
        "oos": {"train_frac": 0.7},
        "walk_forward": {"train_months": 6, "test_months": 2, "anchored": False},
        "monte_carlo": {"n_runs": 10, "ruin_drawdown": 0.3},
        "noise": {"n_runs": 2, "atr_frac": 0.1},
        "sensitivity": {"metric": "sharpe", "pairs": [["donchian_n", "trend_ema"]],
                        "ranges": {"donchian_n": [10, 20], "trend_ema": [20, 30]}},
    },
    "report": {
        "out_dir": "reports", "plotlyjs": "cdn", "monthly_benchmark_pct": [5.0, 6.0],
        "thresholds": {"oos_sharpe_retention": 0.5, "wfe_min": 0.5,
                       "wf_profitable_folds_min": 0.5, "mc_ruin_prob_max": 0.05,
                       "mc_p5_total_return_min": -0.10,
                       "noise_profitable_frac_min": 0.6,
                       "noise_sharpe_retention": 0.5,
                       "sensitivity_plateau_min": 0.5},
    },
}

LIVE_CFG: dict[str, Any] = {
    "mode": "paper",
    "strategy_config": "config/strat.yaml",
    "poll": {"granularity_hours": 4, "delay_after_close_seconds": 90,
             "history_hours": 3000, "max_signal_age_bars": 4},
    "broker": {
        "adapter": "ig",
        "instruments": {"XAUUSD": "EPIC.GOLD"},
        "ig": {"contracts": {"EPIC.GOLD": {
            "oz_per_contract": 1.0, "min_contracts": 0.1,
            "contract_step": 0.1, "level_decimals": 2}}},
    },
    "risk": {"risk_pct": 0.02, "max_open_risk_pct": 0.04, "min_rr": 3.0},
    "regime": {"trend_ema": 20, "slope_lookback_bars": 5, "min_slope_pct": 0.0,
               "use_efficiency_ratio": True, "er_window_bars": 20, "er_min": 0.20},
    "kill": {"daily_loss_limit_pct": 0.05, "max_drawdown_pct": 0.20,
             "max_consecutive_losses": 6, "kill_file": "KILL"},
    "paths": {"state": "live_state/state.json",
              "journal": "live_state/journal.jsonl"},
    "notify": {"telegram": False},
    "paper": {"initial_equity": 10000.0},
    "slippage_alert_r": 0.05,
    "expectations_path": None,
}


def _h1_candles(n: int = 800) -> pd.DataFrame:
    """Bougies horaires déterministes, en tendance douce (assez pour les EMA)."""
    idx = pd.date_range("2026-01-01", periods=n, freq="1h", tz="UTC")
    close = pd.Series([2000.0 + i * 0.5 for i in range(n)], index=idx)
    return pd.DataFrame({
        "open": close - 0.2, "high": close + 1.0, "low": close - 1.0,
        "close": close, "volume": 100.0, "spread": 0.3,
    }, index=idx)


@pytest.fixture
def algo_root(tmp_path: Path) -> Path:
    """Arborescence algo/ minimale mais complète pour le dashboard."""
    root = tmp_path
    (root / "config").mkdir()
    (root / "config" / "strat.yaml").write_text(yaml.safe_dump(STRATEGY_CFG), encoding="utf-8")
    (root / "config" / "live.yaml").write_text(yaml.safe_dump(LIVE_CFG), encoding="utf-8")

    # cache du bot : bougies H1 (source hors-ligne préférée)
    cache = root / "live_state" / "cache"
    cache.mkdir(parents=True)
    _h1_candles().to_csv(cache / "EPIC.GOLD_H1.csv", index_label="time")

    (root / "live_state" / "state.json").write_text(json.dumps({
        "schema_version": 1, "halted": False, "halt_reason": "",
        "hwm_equity": 10500.0,
        "day": {"date": "2026-08-06", "start_equity": 10400.0},
        "consecutive_losses": 0, "last_signal_bar": {},
        "known_trades": {}, "last_closed_trade_id": None,
    }), encoding="utf-8")

    # journal : un ordre accepté puis sa clôture => un trade live reconstructible
    events = [
        {"ts": "2026-08-01T00:00:00+00:00", "type": "cycle", "equity": 10000.0,
         "actions": [], "mode": "paper"},
        {"ts": "2026-08-02T04:00:00+00:00", "type": "order", "instrument": "EPIC.GOLD",
         "units": 2.0, "sl": 1990.0, "tp": 2030.0, "risk_amount": 200.0,
         "accepted": True, "reason": "filled", "trade_id": "T1", "fill": 2000.0},
        {"ts": "2026-08-03T08:00:00+00:00", "type": "trade_closed",
         "instrument": "EPIC.GOLD", "trade_id": "T1", "pnl": 600.0, "price": 2030.0},
        {"ts": "2026-08-04T12:00:00+00:00", "type": "order", "instrument": "EPIC.GOLD",
         "units": 1.0, "sl": 2100.0, "tp": 2200.0, "risk_amount": 100.0,
         "accepted": True, "reason": "filled", "trade_id": "T2", "fill": 2120.0},
    ]
    (root / "live_state" / "journal.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")

    # cache dashboard versionné
    dd = root / "dashboard_data"
    dd.mkdir()
    (dd / "backtest.json").write_text(json.dumps({
        "generated_utc": "2026-08-06T00:00:00+00:00",
        "config": "config/strat.yaml", "strategy": "daily_breakout",
        "params": STRATEGY_CFG["strategy"]["params"], "candle_timeframe": "4h",
        "initial_equity": 10000.0, "risk_pct": 0.0075, "assets": ["XAUUSD"],
        "metrics": {"n_trades": 2, "win_rate": 0.5, "profit_factor": 1.5,
                    "expectancy_r": 0.2, "monthly_mean": 0.003,
                    "max_drawdown": 0.12, "total_return": 0.25, "sharpe": 0.5,
                    "start": "2019-01-01", "end": "2026-06-30"},
        "equity": [[1546300800, 10000.0], [1546387200, 10100.0]],
        "drawdown": [[1546300800, 0.0], [1546387200, -0.01]],
        "monthly": [{"year": 2019, "month": 1, "ret": 0.01}],
        "trades": [{
            "id": "bt-0", "source": "backtest", "asset": "XAUUSD", "side": 1,
            "entry_time": 1546300800, "exit_time": 1546387200,
            "entry": 1280.0, "exit": 1300.0, "units": 10.0, "sl": 1270.0,
            "tp": 1310.0, "pnl": 200.0, "pnl_pct": 0.02, "r_multiple": 2.0,
            "reason": "tp", "bars_held": 12, "risk_amount": 100.0,
        }],
    }), encoding="utf-8")
    (dd / "macro.json").write_text(json.dumps({
        "labels": {"XAUUSD": "Or"},
        "series": {"XAUUSD": [[1546300800, 1280.0], [1546387200, 1300.0]]},
        "correlation": {"symbols": ["XAUUSD"], "matrix": [[1.0]], "note": "test"},
        "ratio": [[1546300800, 80.0]],
    }), encoding="utf-8")
    (dd / "candles_XAUUSD_4h.json").write_text(json.dumps(
        [[1546300800, 1280.0, 1290.0, 1275.0, 1288.0]]), encoding="utf-8")
    return root


@pytest.fixture
def dash(algo_root: Path) -> DashboardData:
    return DashboardData(algo_root, enable_broker=False)


# ---------------------------------------------------------------- hors-ligne

def test_snapshot_sans_broker_reste_complet(dash: DashboardData) -> None:
    """Sans IG, le dashboard doit rester exploitable (garantie du module)."""
    s = dash.snapshot()
    assert s["mode"] == "paper"
    assert s["equity_origin"] == "state"        # pas d'IG => equity de l'état
    assert s["candle_origin"] == "bot_cache"    # bougies du cache du bot
    assert s["equity"] == pytest.approx(10500.0)
    assert s["day_pnl"] == pytest.approx(100.0)
    assert s["halted"] is False
    assert s["risk"]["hard_cap_pct"] == pytest.approx(4.0)
    assert len(s["diagnostics"]) == 1


def test_diagnostic_explique_pourquoi_pas_de_trade(dash: DashboardData) -> None:
    d = dash.snapshot()["diagnostics"][0]
    assert d["asset"] == "XAUUSD"
    assert d["price"] > 0
    # la série monte : le seuil de cassure et l'EMA doivent être calculés
    assert d["breakout_level"] is not None
    assert d["distance_pct"] is not None
    assert d["trend_ok"] is True
    assert "regime" in d and "er_value" in d["regime"]
    assert isinstance(d["regime"]["allowed"], bool)


def test_le_plafond_dur_de_risque_borne_le_prochain_ordre(dash: DashboardData) -> None:
    """La taille annoncée ne doit jamais dépasser le plafond dur de 4 %."""
    d = dash.snapshot()["diagnostics"][0]
    if d.get("next_order"):
        assert d["next_order"]["risk_pct"] <= 4.0 + 1e-9


# -------------------------------------------------------------------- trades

def test_trades_live_reconstruits_depuis_le_journal(dash: DashboardData) -> None:
    live = dash.live_trades()
    assert len(live) == 2
    closed = [t for t in live if not t["open"]][0]
    assert closed["asset"] == "XAUUSD"          # epic retraduit en actif interne
    assert closed["entry"] == pytest.approx(2000.0)
    assert closed["exit"] == pytest.approx(2030.0)
    assert closed["pnl"] == pytest.approx(600.0)
    assert closed["r_multiple"] == pytest.approx(3.0)   # 600 / 200
    # l'ordre T2 n'a jamais été refermé => position encore ouverte
    still_open = [t for t in live if t["open"]][0]
    assert still_open["exit_time"] is None and still_open["pnl"] is None


def test_trades_fusionne_backtest_et_live(dash: DashboardData) -> None:
    t = dash.trades()
    assert len(t["backtest"]) == 1 and len(t["live"]) == 2
    assert all(x["source"] == "backtest" for x in t["backtest"])


def test_candles_recolle_historique_et_bougies_fraiches(dash: DashboardData) -> None:
    c = dash.candles("XAUUSD")
    assert c["n_history"] == 1
    assert c["n_fresh"] > 0                     # le cache du bot prolonge l'historique
    times = [b[0] for b in c["candles"]]
    assert times == sorted(times)               # strictement croissant
    assert len(set(times)) == len(times)        # aucun doublon au raccord


def test_stats_expose_backtest_et_forward(dash: DashboardData) -> None:
    s = dash.stats()
    assert s["backtest"]["metrics"]["n_trades"] == 2
    assert s["forward"]["n_trades"] == 1        # un seul trade clôturé
    assert s["forward"]["total_pnl"] == pytest.approx(600.0)


# ------------------------------------------------------------- kill (sûreté)

def test_arm_kill_ecrit_le_fichier_et_rafraichit(dash: DashboardData, algo_root: Path) -> None:
    assert not (algo_root / "KILL").exists()
    out = dash.arm_kill()
    assert out["ok"] is True
    assert (algo_root / "KILL").exists()
    assert dash.snapshot()["kill_file_present"] is True


# -------------------------------------------------------------------- routes

@pytest.fixture
def server(dash: DashboardData):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Handler, dash=dash))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def _fetch(url: str) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


@pytest.mark.parametrize("route", [
    "/", "/api/snapshot", "/api/trades", "/api/stats", "/api/macro",
    "/api/journal?limit=5", "/api/all", "/api/candles?asset=XAUUSD",
    "/static/app.js", "/static/style.css",
])
def test_routes_repondent_200(server: str, route: str) -> None:
    status, body = _fetch(server + route)
    assert status == 200 and body


def test_actif_inconnu_rejete(server: str) -> None:
    status, _ = _fetch(server + "/api/candles?asset=DOGE")
    assert status == 400


def test_kill_refuse_sans_confirmation(server: str, algo_root: Path) -> None:
    """Le kill switch ne doit jamais partir sur un simple POST vide."""
    req = urllib.request.Request(
        server + "/api/kill", data=b"{}",
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=20)
        pytest.fail("un POST sans confirmation aurait dû être rejeté")
    except urllib.error.HTTPError as e:
        assert e.code == 400
    assert not (algo_root / "KILL").exists()


def test_pas_de_remontee_hors_du_dossier_statique(server: str) -> None:
    status, _ = _fetch(server + "/static/../../config/live.yaml")
    assert status != 200


# ------------------------------------------------- alignement du risque

def test_le_cache_reprend_le_risque_reel_du_bot(algo_root: Path) -> None:
    """Le backtest du dashboard doit décrire le risque RÉELLEMENT pris."""
    cfg = load_config(algo_root / "config" / "strat.yaml")
    assert cfg.engine.risk_pct == pytest.approx(0.0075)      # risque de recherche
    out, source = _apply_live_risk(cfg, str(algo_root / "config" / "live.yaml"))
    assert out.engine.risk_pct == pytest.approx(0.02)        # risque du bot
    assert out.engine.max_open_risk_pct == pytest.approx(0.04)
    assert "config live" in source
    # la stratégie elle-même ne bouge pas : mêmes signaux, mêmes dates
    assert out.strategy == cfg.strategy
    assert out.engine.initial_equity == cfg.engine.initial_equity


def test_le_risque_du_cache_ne_depasse_jamais_le_plafond_dur(
    algo_root: Path, tmp_path: Path
) -> None:
    """Une config live trop gourmande ne doit pas produire un backtest menteur."""
    live = dict(LIVE_CFG)
    live["risk"] = {"risk_pct": 0.50, "max_open_risk_pct": 0.60, "min_rr": 3.0}
    p = tmp_path / "live_gourmand.yaml"
    p.write_text(yaml.safe_dump(live), encoding="utf-8")
    cfg = load_config(algo_root / "config" / "strat.yaml")
    out, _ = _apply_live_risk(cfg, str(p))
    assert out.engine.risk_pct == pytest.approx(HARD_MAX_RISK_PCT)


# ----------------------------------------------------------------- analytics

def test_excursions_mesure_le_chemin_parcouru() -> None:
    """MAE/MFE se lisent sur les bougies TRAVERSÉES, pas sur entrée/sortie."""
    from goldsilver.dashboard import analytics

    # long entré à 100, stop à 90 (risque 10) : le prix descend à 95 puis monte à 130
    candles = {"XAUUSD": [
        [1000, 100, 101, 99, 100],
        [2000, 100, 102, 95, 96],     # creux à 95 -> MAE = (95-100)/10 = -0.5 R
        [3000, 96, 130, 96, 128],     # sommet 130 -> MFE = (130-100)/10 = +3.0 R
    ]}
    trades = [{"id": "t1", "asset": "XAUUSD", "side": 1, "entry": 100.0, "sl": 90.0,
               "entry_time": 1000, "exit_time": 3000, "r_multiple": 2.8}]
    out = analytics.excursions(trades, candles)
    assert out["n"] == 1
    assert out["trades"][0]["mae"] == pytest.approx(-0.5)
    assert out["trades"][0]["mfe"] == pytest.approx(3.0)


def test_streaks_compte_les_series_consecutives() -> None:
    from goldsilver.dashboard import analytics

    rs = [1.0, -1.0, -1.0, -1.0, 2.0, 2.0, -1.0]
    trades = [{"r_multiple": r} for r in rs]
    st = analytics.streaks(trades)
    assert st["max_losses"] == 3
    assert st["max_wins"] == 2
    assert {"len": 3, "count": 1} in st["hist_losses"]


def test_monte_carlo_borne_les_percentiles() -> None:
    """Le cône doit être ordonné et refuser un échantillon trop petit."""
    from goldsilver.dashboard import analytics

    trades = [{"r_multiple": r} for r in ([-1.0] * 60 + [3.0] * 40)]
    mc = analytics.monte_carlo(trades, risk_pct=0.02, horizon=10, paths=500)
    assert mc["bands"]["p5"][-1] <= mc["bands"]["p50"][-1] <= mc["bands"]["p95"][-1]
    assert 0.0 <= mc["prob_negative"] <= 1.0
    # échantillon insuffisant => pas de projection plutôt qu'une projection fausse
    assert analytics.monte_carlo([{"r_multiple": 1.0}] * 5, 0.02) == {}


def test_progression_de_la_position_en_r() -> None:
    from goldsilver.dashboard import analytics

    pos = {"avg_price": 100.0, "sl": 90.0, "tp": 130.0, "units": 2.0}
    p = analytics.position_progress(pos, price=110.0)
    assert p["r_now"] == pytest.approx(1.0)      # +10 pour 10 de risque
    assert p["r_target"] == pytest.approx(3.0)
    assert 0.0 <= p["progress"] <= 1.0


def test_esperance_glissante_sans_horodatage_duplique() -> None:
    """Un graphique temporel exige des temps strictement croissants."""
    from goldsilver.dashboard import analytics

    trades = [{"r_multiple": 1.0, "exit_time": 1000 + (i // 2)} for i in range(80)]
    pts = analytics.rolling_expectancy(trades, window=10)
    times = [p[0] for p in pts]
    assert times == sorted(times)
    assert len(set(times)) == len(times)


def test_analytics_route_et_payload(dash: DashboardData, server: str) -> None:
    status, body = _fetch(server + "/api/analytics")
    assert status == 200
    payload = json.loads(body)
    for k in ("excursions", "streaks", "time", "rolling_expectancy", "monte_carlo", "costs"):
        assert k in payload


# -------------------------------------------------------------------- export

def test_export_html_est_autonome(algo_root: Path, tmp_path: Path) -> None:
    out = export_html(algo_root, tmp_path / "export.html", enable_broker=False)
    html = out.read_text(encoding="utf-8")
    assert "__GS_DATA__" in html
    # aucune référence réseau : tout est inliné
    assert 'src="/static/' not in html
    assert 'href="/static/' not in html
    assert "TradingView" in html          # bibliothèque de chart embarquée
    assert out.stat().st_size > 100_000
