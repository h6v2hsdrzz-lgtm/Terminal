"""Couche de données du dashboard : assemble tout ce que l'interface affiche.

Principe directeur : **le dashboard ne doit JAMAIS être vide, et ne doit
JAMAIS casser le bot**. Trois conséquences dans ce module :

1. *Dégradation gracieuse* — chaque source (IG, journal, cache) est optionnelle.
   IG injoignable ou identifiants absents => on bascule sur le cache disque du
   bot, puis sur le cache backtest versionné. L'interface affiche d'où vient
   chaque chiffre plutôt que de mentir par omission.
2. *Lecture seule* — aucun ordre, aucune écriture d'état. Le dashboard observe.
   Seule exception explicite : le kill switch (``arm_kill``), qui est une
   action de SÉCURITÉ (il arrête le bot, il ne peut pas ouvrir de position).
3. *Cache TTL* — une page ouverte en permanence ne doit pas marteler l'API IG
   (quota hebdomadaire de bougies). Chaque source a son TTL.

Fraîcheur des bougies, par ordre de préférence :
    IG en direct  ->  cache H1 du bot (live_state/cache)  ->  cache backtest
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from goldsilver.config import load_config
from goldsilver.data.cleaning import clean_ohlcv
from goldsilver.data.timeframes import build_timeframes
from goldsilver.engine.sizing import position_size
from goldsilver.live.config import load_live_config
from goldsilver.live.forward_report import compute_forward_stats
from goldsilver.live.journal import Journal
from goldsilver.live.regime import assess_regime
from goldsilver.live.risk import HARD_MAX_RISK_PCT
from goldsilver.live.state import StateStore
from goldsilver.strategy.base import get_strategy

log = logging.getLogger(__name__)

CACHE_DIR_NAME = "dashboard_data"


def _round(x: Any, nd: int = 2) -> Any:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return round(v, nd) if np.isfinite(v) else None


@dataclass
class _Cached:
    value: Any
    at: float


class _TTLCache:
    """Cache mémoire minimal, thread-safe : une entrée par clé, TTL en secondes."""

    def __init__(self) -> None:
        self._d: dict[str, _Cached] = {}
        self._lock = threading.Lock()

    def get(self, key: str, ttl: float, producer: Callable[[], Any]) -> Any:
        with self._lock:
            hit = self._d.get(key)
            if hit is not None and (time.time() - hit.at) < ttl:
                return hit.value
        value = producer()          # hors du verrou : un appel réseau lent ne
        with self._lock:            # doit pas bloquer les autres routes
            self._d[key] = _Cached(value, time.time())
        return value

    def invalidate(self, key: str | None = None) -> None:
        with self._lock:
            self._d.clear() if key is None else self._d.pop(key, None)


class DashboardData:
    """Agrège cache backtest + journal live + broker IG pour l'interface."""

    def __init__(self, algo_root: Path, live_config: str = "config/live.yaml",
                 enable_broker: bool = True) -> None:
        self.root = algo_root
        self.cache_dir = algo_root / CACHE_DIR_NAME
        self.enable_broker = enable_broker
        self._ttl = _TTLCache()
        self._broker: Any = None
        self._broker_failed = ""

        self.cfg = load_live_config(str(algo_root / live_config))
        self.strategy_cfg = load_config(self.cfg.resolve(self.cfg.strategy_config))
        self.strategy = get_strategy(self.strategy_cfg.strategy.name,
                                     self.strategy_cfg.strategy.params)
        self.assets = list(self.cfg.broker.instruments)

    # ------------------------------------------------------------ cache disque

    def _load_json(self, name: str) -> Any:
        path = self.cache_dir / name
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.error("cache %s illisible : %s", name, exc)
            return None

    def backtest(self) -> dict[str, Any]:
        return self._ttl.get("backtest", 300.0,
                             lambda: self._load_json("backtest.json") or {})

    def macro_cache(self) -> dict[str, Any]:
        return self._ttl.get("macro", 300.0,
                             lambda: self._load_json("macro.json") or {})

    # ------------------------------------------------------------------ broker

    def _get_broker(self) -> Any:
        """Instancie l'adaptateur IG à la demande. Échec => mode hors-ligne."""
        if not self.enable_broker or self._broker_failed:
            return None
        if self._broker is not None:
            return self._broker
        try:
            from goldsilver.live.broker.ig import IgBroker
            from goldsilver.live.modes import TradingMode
            self._broker = IgBroker(
                expected_env="live" if self.cfg.mode is TradingMode.LIVE else "demo",
                contracts=self.cfg.broker.ig_contracts,
                cache_dir=self.cfg.resolve("live_state/cache"),
            )
        except Exception as exc:  # noqa: BLE001 — hors-ligne reste utilisable
            self._broker_failed = str(exc)
            log.warning("IG indisponible, dashboard en mode hors-ligne : %s", exc)
            return None
        return self._broker

    # ----------------------------------------------------------------- bougies

    def _candles_from_bot_cache(self, asset: str) -> pd.DataFrame | None:
        """Bougies H1 déposées par le bot à chaque cycle (aucun appel réseau)."""
        epic = self.cfg.broker.instruments[asset]
        path = self.cfg.resolve("live_state/cache") / f"{epic}_H1.csv"
        if not path.exists():
            return None
        try:
            df = pd.read_csv(path, parse_dates=["time"]).set_index("time").sort_index()
            if df.index.tz is None:
                df.index = df.index.tz_localize("UTC")
            return df
        except (OSError, ValueError, KeyError) as exc:
            log.error("cache bot %s illisible : %s", path.name, exc)
            return None

    def _h1_candles(self, asset: str) -> tuple[pd.DataFrame | None, str]:
        """Retourne (bougies H1, origine). Origine : ig | bot_cache | none."""
        broker = self._get_broker()
        if broker is not None:
            try:
                df = broker.get_candles(self.cfg.broker.instruments[asset],
                                        self.cfg.poll.history_hours)
                if df is not None and len(df):
                    return df, "ig"
            except Exception as exc:  # noqa: BLE001
                log.warning("IG bougies %s : %s", asset, exc)
        df = self._candles_from_bot_cache(asset)
        return (df, "bot_cache") if df is not None else (None, "none")

    def candles(self, asset: str) -> dict[str, Any]:
        """Bougies du chart : historique backtest + rallonge fraîche.

        L'historique versionné couvre 2019->2026-06 ; la rallonge (cache bot ou
        IG) couvre les jours suivants. Recoller les deux donne un chart continu
        de la première à la dernière décision de l'algo.
        """
        def _build() -> dict[str, Any]:
            tf = (self.backtest().get("candle_timeframe") or "4h")
            hist = self._load_json(f"candles_{asset}_{tf}.json") or []
            df, origin = self._h1_candles(asset)
            fresh: list[list[Any]] = []
            if df is not None and len(df):
                cleaned = clean_ohlcv(df)[0]
                tfs = build_timeframes(
                    cleaned, self.strategy_cfg.data.base_timeframe,
                    self.strategy_cfg.data.timeframes,
                    self.strategy_cfg.data.session_day_offset_hours,
                )
                sub = tfs.get(tf)
                if sub is not None and len(sub):
                    nd = 3 if asset == "XAGUSD" else 2
                    secs = (sub.index.as_unit("ns").asi8 // 1_000_000_000).tolist()
                    fresh = [
                        [t, _round(o, nd), _round(h, nd), _round(lo, nd), _round(c, nd)]
                        for t, o, h, lo, c in zip(secs, sub["open"], sub["high"],
                                                  sub["low"], sub["close"])
                    ]
            last_hist = hist[-1][0] if hist else 0
            merged = hist + [b for b in fresh if b[0] > last_hist]
            return {
                "asset": asset,
                "timeframe": tf,
                "origin": origin,
                "candles": merged,
                "n_history": len(hist),
                "n_fresh": len([b for b in fresh if b[0] > last_hist]),
            }

        return self._ttl.get(f"candles:{asset}", 120.0, _build)

    # ------------------------------------------------- diagnostic « pourquoi ? »

    def _signal_diagnostic(self, asset: str, tfs: dict[str, pd.DataFrame],
                           equity: float) -> dict[str, Any]:
        """Pourquoi l'algo ne trade pas (ou va trader) — le panneau clé.

        Répond en un coup d'œil à « il y a de la volatilité, pourquoi rien ? » :
        distance au seuil de cassure, état du filtre de tendance, efficience du
        mouvement (ER), et taille qu'aurait le prochain ordre.
        """
        params = self.strategy_cfg.strategy.params
        tf = params.get("trend_timeframe", "4h")
        f = tfs.get(tf)
        out: dict[str, Any] = {"asset": asset, "timeframe": tf}
        if f is None or f.empty:
            return {**out, "error": "pas de bougies"}

        close = f["close"]
        px = float(close.iloc[-1])
        out["last_bar"] = int(f.index[-1].timestamp())
        out["price"] = _round(px, 4)

        n = int(params.get("donchian_n", 0) or 0)
        if n and len(f) > n:
            level = float(f["high"].shift(1).rolling(n).max().iloc[-1])
            out["breakout_level"] = _round(level, 4)
            out["distance_pct"] = _round((level - px) / px * 100.0, 3)

        ema_n = int(params.get("trend_ema", 0) or 0)
        if ema_n:
            e = float(close.ewm(span=ema_n, adjust=False).mean().iloc[-1])
            out["trend_ema"] = _round(e, 4)
            out["trend_ok"] = bool(px > e)

        status = assess_regime(asset, f, self.cfg.regime)
        out["regime"] = {
            "allowed": bool(status.trading_allowed),
            "trend_ok": bool(status.trend_ok),
            "slope_pct": _round(100 * status.slope_pct, 3),
            "er_value": _round(status.er_value, 3),
            "er_min": self.cfg.regime.er_min,
            "detail": status.detail,
        }

        # volatilité récente : amplitude parcourue sur ~4 jours de bougies 4h
        tail = f.tail(24)
        if len(tail) > 1:
            hi, lo = float(tail["high"].max()), float(tail["low"].min())
            out["range_recent"] = {
                "high": _round(hi, 4), "low": _round(lo, 4),
                "amplitude_pct": _round((hi - lo) / lo * 100.0, 2),
            }

        # signal courant + taille du prochain ordre au risque configuré
        try:
            frame = self.strategy.generate_all({asset: tfs})[asset]
            last = frame.iloc[-1]
            side = int(last["signal"])
            out["signal"] = side
            sl_dist = float(last.get("sl_dist") or 0.0)
            tp_dist = float(last.get("tp_dist") or 0.0)
            out["sl_dist"] = _round(sl_dist, 4)
            out["tp_dist"] = _round(tp_dist, 4)
            if sl_dist > 0 and equity > 0:
                spec = self.strategy_cfg.data.assets[asset]
                risk_pct = min(self.cfg.risk.risk_pct, HARD_MAX_RISK_PCT)
                dec = position_size(
                    equity=equity, risk_pct=risk_pct, sl_dist=sl_dist, price=px,
                    spec=spec,
                    risk_budget_left=equity * self.cfg.risk.max_open_risk_pct,
                    max_leverage=self.strategy_cfg.engine.max_leverage,
                    open_notional=0.0,
                )
                out["next_order"] = {
                    "units": _round(dec.units, 4),
                    "risk_amount": _round(dec.risk_amount),
                    "risk_pct": _round(100 * risk_pct, 2),
                    "sl_price": _round(px - sl_dist, 4),
                    "tp_price": _round(px + tp_dist, 4),
                    "reason": dec.reason,
                }
        except Exception as exc:  # noqa: BLE001 — diagnostic best-effort
            out["signal_error"] = str(exc)
        return out

    # ---------------------------------------------------------------- snapshot

    def snapshot(self) -> dict[str, Any]:
        return self._ttl.get("snapshot", 45.0, self._build_snapshot)

    def _build_snapshot(self) -> dict[str, Any]:
        state = StateStore(self.cfg.resolve(self.cfg.state_path)).load()
        bt = self.backtest()
        equity = float(state.get("hwm_equity") or 0.0)
        positions: list[dict[str, Any]] = []
        quotes: dict[str, Any] = {}
        origin = "state"

        broker = self._get_broker()
        if broker is not None:
            try:
                equity = float(broker.get_account().equity)
                origin = "ig"
            except Exception as exc:  # noqa: BLE001
                log.warning("IG equity : %s", exc)
            try:
                for p in broker.get_open_positions():
                    positions.append({
                        "instrument": p.instrument, "units": _round(p.units, 4),
                        "avg_price": _round(p.avg_price, 4),
                        "sl": _round(p.sl, 4), "tp": _round(p.tp, 4),
                        "trade_id": p.trade_id,
                        "unrealized_pnl": _round(p.unrealized_pnl),
                    })
            except Exception as exc:  # noqa: BLE001
                log.warning("IG positions : %s", exc)
            for a in self.assets:
                try:
                    q = broker.get_quote(self.cfg.broker.instruments[a])
                    quotes[a] = {"bid": _round(q.bid, 4), "ask": _round(q.ask, 4),
                                 "tradeable": bool(q.tradeable),
                                 "spread": _round(q.ask - q.bid, 4)}
                except Exception as exc:  # noqa: BLE001
                    log.warning("IG quote %s : %s", a, exc)

        # diagnostic par actif sur les bougies les plus fraîches disponibles
        diagnostics = []
        candle_origin = "none"
        for a in self.assets:
            df, o = self._h1_candles(a)
            candle_origin = o if o != "none" else candle_origin
            if df is None or df.empty:
                diagnostics.append({"asset": a, "error": "aucune bougie"})
                continue
            try:
                tfs = build_timeframes(
                    clean_ohlcv(df)[0], self.strategy_cfg.data.base_timeframe,
                    self.strategy_cfg.data.timeframes,
                    self.strategy_cfg.data.session_day_offset_hours,
                )
                diagnostics.append(self._signal_diagnostic(a, tfs, equity))
            except Exception as exc:  # noqa: BLE001
                diagnostics.append({"asset": a, "error": str(exc)})

        day = state.get("day") or {}
        day_start = float(day.get("start_equity") or equity or 0.0)
        hwm = float(state.get("hwm_equity") or equity or 0.0)
        kill_file = self.cfg.resolve(self.cfg.kill.kill_file)

        return {
            "generated_utc": pd.Timestamp.now(tz="UTC").isoformat(timespec="seconds"),
            "mode": self.cfg.mode.value,
            "strategy": self.strategy_cfg.strategy.name,
            "strategy_config": self.cfg.strategy_config,
            "params": dict(self.strategy_cfg.strategy.params),
            "equity": _round(equity),
            "equity_origin": origin,
            "candle_origin": candle_origin,
            "broker_error": self._broker_failed or None,
            "hwm_equity": _round(hwm),
            "day_start_equity": _round(day_start),
            "day_pnl": _round(equity - day_start),
            "day_pnl_pct": _round(100 * (equity / day_start - 1.0), 3) if day_start else None,
            "drawdown_pct": _round(100 * (equity / hwm - 1.0), 3) if hwm else None,
            "halted": bool(state.get("halted")),
            "halt_reason": state.get("halt_reason") or "",
            "kill_file_present": kill_file.exists(),
            "consecutive_losses": int(state.get("consecutive_losses") or 0),
            "risk": {
                "risk_pct": _round(100 * self.cfg.risk.risk_pct, 2),
                "hard_cap_pct": _round(100 * HARD_MAX_RISK_PCT, 2),
                "max_open_risk_pct": _round(100 * self.cfg.risk.max_open_risk_pct, 2),
                "max_dd_pct": _round(100 * self.cfg.kill.max_drawdown_pct, 2),
                "max_daily_loss_pct": _round(100 * self.cfg.kill.daily_loss_limit_pct, 2),
                "max_consecutive_losses": self.cfg.kill.max_consecutive_losses,
            },
            "positions": positions,
            "quotes": quotes,
            "diagnostics": diagnostics,
            "backtest_reference": {
                "n_trades": bt.get("metrics", {}).get("n_trades"),
                "win_rate": bt.get("metrics", {}).get("win_rate"),
                "expectancy_r": bt.get("metrics", {}).get("expectancy_r"),
                "profit_factor": bt.get("metrics", {}).get("profit_factor"),
                "monthly_mean": bt.get("metrics", {}).get("monthly_mean"),
                "max_drawdown": bt.get("metrics", {}).get("max_drawdown"),
                "generated_utc": bt.get("generated_utc"),
            },
        }

    # ------------------------------------------------------------------ trades

    def _journal(self) -> list[dict[str, Any]]:
        return self._ttl.get(
            "journal", 20.0,
            lambda: Journal(self.cfg.resolve(self.cfg.journal_path)).read_all(),
        )

    def live_trades(self) -> list[dict[str, Any]]:
        """Reconstruit les trades réels du bot à partir du journal append-only."""
        events = self._journal()
        orders = {e.get("trade_id"): e for e in events
                  if e.get("type") == "order" and e.get("accepted") and e.get("trade_id")}
        instr_to_asset = {v: k for k, v in self.cfg.broker.instruments.items()}
        out: list[dict[str, Any]] = []

        closed_ids: set[str] = set()
        for e in events:
            if e.get("type") != "trade_closed":
                continue
            tid = e.get("trade_id")
            closed_ids.add(tid)
            o = orders.get(tid, {})
            units = float(o.get("units") or 0.0)
            risk = float(o.get("risk_amount") or 0.0)
            pnl = float(e.get("pnl") or 0.0)
            out.append({
                "id": f"live-{tid}",
                "source": "live",
                "asset": instr_to_asset.get(e.get("instrument"), e.get("instrument")),
                "side": 1 if units >= 0 else -1,
                "entry_time": int(pd.Timestamp(o["ts"]).timestamp()) if o.get("ts") else None,
                "exit_time": int(pd.Timestamp(e["ts"]).timestamp()) if e.get("ts") else None,
                "entry": _round(o.get("fill"), 4),
                "exit": _round(e.get("price"), 4),
                "units": _round(abs(units), 4),
                "sl": _round(o.get("sl"), 4),
                "tp": _round(o.get("tp"), 4),
                "pnl": _round(pnl),
                "r_multiple": _round(pnl / risk, 3) if risk else None,
                "reason": "broker",
                "risk_amount": _round(risk),
                "open": False,
            })

        # ordres acceptés jamais refermés = positions encore ouvertes
        for tid, o in orders.items():
            if tid in closed_ids:
                continue
            units = float(o.get("units") or 0.0)
            out.append({
                "id": f"live-{tid}",
                "source": "live",
                "asset": instr_to_asset.get(o.get("instrument"), o.get("instrument")),
                "side": 1 if units >= 0 else -1,
                "entry_time": int(pd.Timestamp(o["ts"]).timestamp()) if o.get("ts") else None,
                "exit_time": None,
                "entry": _round(o.get("fill"), 4),
                "exit": None,
                "units": _round(abs(units), 4),
                "sl": _round(o.get("sl"), 4),
                "tp": _round(o.get("tp"), 4),
                "pnl": None,
                "r_multiple": None,
                "reason": "en cours",
                "risk_amount": _round(o.get("risk_amount")),
                "open": True,
            })
        out.sort(key=lambda t: t.get("entry_time") or 0)
        return out

    def trades(self) -> dict[str, Any]:
        bt = self.backtest()
        live = self.live_trades()
        return {
            "backtest": bt.get("trades", []),
            "live": live,
            "backtest_period": {
                "start": bt.get("metrics", {}).get("start"),
                "end": bt.get("metrics", {}).get("end"),
            },
        }

    # ------------------------------------------------------------------- stats

    def stats(self) -> dict[str, Any]:
        bt = self.backtest()
        fwd = compute_forward_stats(self._journal())
        return {
            "backtest": {
                "metrics": bt.get("metrics", {}),
                "equity": bt.get("equity", []),
                "drawdown": bt.get("drawdown", []),
                "monthly": bt.get("monthly", []),
                "initial_equity": bt.get("initial_equity"),
                "risk_pct": bt.get("risk_pct"),
                "max_open_risk_pct": bt.get("max_open_risk_pct"),
                "risk_source": bt.get("risk_source"),
                "params": bt.get("params", {}),
                "generated_utc": bt.get("generated_utc"),
            },
            "forward": {
                "n_trades": fwd.n_trades,
                "win_rate": _round(fwd.win_rate, 4),
                "expectancy_r": _round(fwd.expectancy_r, 4),
                "profit_factor": _round(fwd.profit_factor, 4),
                "total_pnl": _round(fwd.total_pnl),
                "trades_per_month": _round(fwd.trades_per_month, 2),
                "mean_slippage_r": _round(fwd.mean_slippage_r, 5),
                "days_running": _round(fwd.days_running, 2),
            },
        }

    # ------------------------------------------------------------------- macro

    def macro(self) -> dict[str, Any]:
        cache = self.macro_cache()
        snap = self.snapshot()
        live_ratio = None
        q = snap.get("quotes", {})
        if q.get("XAUUSD") and q.get("XAGUSD"):
            gold = q["XAUUSD"].get("bid")
            silver = q["XAGUSD"].get("bid")
            if gold and silver:
                live_ratio = _round(gold / silver, 3)
        return {**cache, "live_ratio": live_ratio, "quotes": q}

    # ----------------------------------------------------------------- journal

    def journal(self, limit: int = 200) -> list[dict[str, Any]]:
        events = self._journal()
        return events[-limit:][::-1]

    # ------------------------------------------------------- action de sécurité

    def arm_kill(self) -> dict[str, Any]:
        """Pose le fichier KILL : au prochain cycle le bot ferme tout et se halte.

        C'est la SEULE écriture du dashboard. Fail-safe par construction : elle
        ne peut qu'arrêter le bot, jamais ouvrir une position.
        """
        path = self.cfg.resolve(self.cfg.kill.kill_file)
        path.write_text(
            f"armé depuis le dashboard le "
            f"{pd.Timestamp.now(tz='UTC').isoformat(timespec='seconds')}\n",
            encoding="utf-8",
        )
        self._ttl.invalidate("snapshot")
        return {"ok": True, "kill_file": str(path)}
