"""CLI du bot : run / flatten / report / reset-halt / status.

  python3 -m goldsilver.live run           # boucle continue (paper par défaut)
  python3 -m goldsilver.live run --once    # un seul cycle (cron externe)
  python3 -m goldsilver.live flatten       # ferme tout immédiatement
  python3 -m goldsilver.live report        # forward test vs backtest
  python3 -m goldsilver.live reset-halt    # lève la halte (action humaine)
  python3 -m goldsilver.live status        # état courant

Arrêt d'urgence sans CLI : créer le fichier ``KILL`` à la racine d'algo/ —
le prochain cycle flatten et se met en halte (et ne redémarre pas seul).
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

import pandas as pd

from goldsilver.live.broker.base import BrokerAdapter
from goldsilver.live.broker.oanda import OandaBroker
from goldsilver.live.broker.paper import PaperBroker, default_paper_state
from goldsilver.live.config import LiveConfig, load_live_config
from goldsilver.live.engine import CycleReport, LiveEngine
from goldsilver.live.journal import Journal
from goldsilver.live.modes import TradingMode, check_live_gate
from goldsilver.live.notify import TelegramNotifier
from goldsilver.live.state import StateStore

log = logging.getLogger("goldsilver.live")


def _build_broker(cfg: LiveConfig, state: dict) -> BrokerAdapter:
    if cfg.broker.adapter != "oanda":
        raise SystemExit(f"Adaptateur broker inconnu : {cfg.broker.adapter!r} "
                         "(disponible : oanda ; IG à venir via BrokerAdapter)")
    if cfg.mode is TradingMode.LIVE:
        source = OandaBroker(expected_env="live")
    else:
        source = OandaBroker(expected_env="practice")
    if cfg.mode is TradingMode.PAPER:
        if state.get("paper") is None:
            state["paper"] = default_paper_state(cfg.paper_initial_equity)
        return PaperBroker(source, state["paper"])
    return source


def _make_engine(cfg: LiveConfig, cli_enable_live: bool) -> tuple[LiveEngine, StateStore]:
    check_live_gate(cfg.mode, cli_enable_live)
    store = StateStore(cfg.resolve(cfg.state_path))
    state = store.load()
    broker = _build_broker(cfg, state)
    store.save(state)  # persiste l'init du sous-état paper le cas échéant
    engine = LiveEngine(
        cfg, broker, store,
        Journal(cfg.resolve(cfg.journal_path)),
        TelegramNotifier(enabled=cfg.telegram_enabled),
    )
    return engine, store


def _next_boundary(now: pd.Timestamp, hours: int, delay_s: int) -> pd.Timestamp:
    base = now.floor(f"{hours}h")
    boundary = base + pd.Timedelta(hours=hours)
    return boundary + pd.Timedelta(seconds=delay_s)


def cmd_run(cfg: LiveConfig, once: bool, enable_live: bool) -> int:
    engine, store = _make_engine(cfg, enable_live)
    mode = cfg.mode.value.upper()
    log.info("Démarrage %s — stratégie %s — risque %.2f %%/trade (plafond dur 2 %%)",
             mode, cfg.strategy_config, 100 * cfg.risk.risk_pct)
    if cfg.mode is TradingMode.LIVE:
        log.warning("MODE LIVE : ARGENT RÉEL. Kill switch = fichier %s",
                    cfg.kill.kill_file)
    if once:
        report = engine.run_cycle()
        for a in report.actions:
            log.info("  %s", a)
        return 0
    while True:
        report = engine.run_cycle()
        for a in report.actions:
            log.info("  %s", a)
        if report.halted:
            log.warning("Halte active — la boucle continue de surveiller le "
                        "fichier KILL mais ne trade plus. Ctrl-C pour quitter.")
        nxt = _next_boundary(pd.Timestamp.now(tz="UTC"),
                             cfg.poll.granularity_hours,
                             cfg.poll.delay_after_close_seconds)
        sleep_s = max((nxt - pd.Timestamp.now(tz="UTC")).total_seconds(), 30.0)
        log.info("Prochain cycle : %s (dans %.0f min)", nxt, sleep_s / 60)
        try:
            time.sleep(sleep_s)
        except KeyboardInterrupt:
            log.info("Arrêt demandé (Ctrl-C). Les SL/TP restent posés côté broker.")
            return 0


def cmd_flatten(cfg: LiveConfig, enable_live: bool) -> int:
    engine, store = _make_engine(cfg, enable_live)
    state = store.load()
    engine._halt(state, CycleReport(), "flatten manuel via CLI")
    log.info("Flatten exécuté ; halte posée (reset-halt pour reprendre).")
    return 0


def cmd_reset_halt(cfg: LiveConfig) -> int:
    store = StateStore(cfg.resolve(cfg.state_path))
    state = store.load()
    kill = cfg.resolve(cfg.kill.kill_file)
    if kill.exists():
        log.error("Le fichier %s existe encore — le supprimer d'abord "
                  "(c'est lui la demande d'arrêt).", kill)
        return 1
    if not state.get("halted"):
        log.info("Aucune halte en place.")
        return 0
    state["halted"] = False
    state["halt_reason"] = ""
    state["consecutive_losses"] = 0
    store.save(state)
    log.info("Halte levée. Relancer `run` pour reprendre le trading.")
    return 0


def cmd_status(cfg: LiveConfig) -> int:
    store = StateStore(cfg.resolve(cfg.state_path))
    state = store.load()
    log.info("mode=%s halted=%s (%s) hwm=%s pertes_consécutives=%s",
             cfg.mode.value, state.get("halted"), state.get("halt_reason") or "-",
             state.get("hwm_equity"), state.get("consecutive_losses"))
    paper = state.get("paper")
    if paper:
        log.info("paper: cash=%.2f positions=%s trades_clos=%d",
                 paper["cash"], list(paper["positions"]), len(paper["closed"]))
    return 0


def cmd_report(cfg: LiveConfig) -> int:
    from goldsilver.live.forward_report import build_report

    text = build_report(cfg)
    print(text)
    out = cfg.resolve("reports/forward_report.md")
    out.parent.mkdir(exist_ok=True)
    out.write_text(text, encoding="utf-8")
    log.info("Rapport écrit : %s", out)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="goldsilver-live",
        description="Exécution automatique (paper -> demo -> live verrouillé)",
    )
    parser.add_argument("-c", "--config", default="config/live.yaml")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    run_p = sub.add_parser("run", help="boucle de trading (ou --once)")
    run_p.add_argument("--once", action="store_true")
    run_p.add_argument("--enable-live", action="store_true",
                       help="3e verrou du mode LIVE (avec la config et l'env)")
    flat_p = sub.add_parser("flatten", help="ferme tout immédiatement + halte")
    flat_p.add_argument("--enable-live", action="store_true")
    sub.add_parser("reset-halt", help="lève la halte (action humaine explicite)")
    sub.add_parser("status", help="état courant")
    sub.add_parser("report", help="rapport forward test vs backtest")

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S", stream=sys.stdout,
    )
    cfg = load_live_config(args.config)
    if args.command == "run":
        return cmd_run(cfg, args.once, args.enable_live)
    if args.command == "flatten":
        return cmd_flatten(cfg, args.enable_live)
    if args.command == "reset-halt":
        return cmd_reset_halt(cfg)
    if args.command == "status":
        return cmd_status(cfg)
    if args.command == "report":
        return cmd_report(cfg)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
