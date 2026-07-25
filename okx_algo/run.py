"""Point d'entree unique. Reprise idempotente apres interruption (§17.4).

    python -m okx_algo.run --resume        # reprend exactement ou on s'est arrete
    python -m okx_algo.run --step <nom>    # rejoue/force une etape precise
    python -m okx_algo.run --status        # etat courant, sans rien executer

Une etape deja terminee n'est jamais recalculee et n'ajoute aucune ligne au
registre d'essais.
"""
from __future__ import annotations

import argparse
import logging
import sys
import traceback
from typing import Callable

from .core.config import Config, load_config
from .core.persist import RunState

PIPELINE: list[tuple[str, str]] = [
    ("data_fast", "Telechargement OHLCV HTF, mark, index, funding, open interest"),
    ("data_minute", "Telechargement OHLCV 1 minute (long)"),
    ("data_quality", "Rapport de qualite des donnees"),
    ("engine_selftest", "Validation du moteur sur strategies triviales"),
    ("brique1", "Brique 1 — momentum time-series, in-sample"),
    ("brique2", "Brique 2 — momentum cross-sectionnel, in-sample"),
    ("brique3", "Brique 3 — reversal post-cascade, in-sample"),
    ("portfolio", "Modulateur funding + combinaison risk parity"),
    ("universe_h2", "H2 — etude d'extension de l'univers cross-sectionnel"),
    ("research", "Boucle de recherche sous protocole (§16)"),
    ("leverage", "Calibration du levier (§8)"),
    ("validation_oos", "Ouverture unique de l'out-of-sample + validation"),
    ("report", "Rapport final"),
]


def setup_logging(cfg: Config, name: str = "run") -> None:
    cfg.logs_root.mkdir(parents=True, exist_ok=True)
    handlers: list[logging.Handler] = [logging.FileHandler(cfg.logs_root / f"{name}.log")]
    handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)-22s %(message)s",
        handlers=handlers,
        force=True,
    )


# ----------------------------------------------------------------------
def step_data_fast(cfg: Config, state: RunState) -> None:
    from .data.download import Downloader
    Downloader(cfg, state).run_fast(cfg.get("universe.symbols"))


def step_data_minute(cfg: Config, state: RunState) -> None:
    from .data.download import Downloader
    Downloader(cfg, state).run_minute(cfg.get("universe.symbols"))


def step_data_quality(cfg: Config, state: RunState) -> None:
    from .data.quality import run_quality_report
    run_quality_report(cfg, state)


def step_engine_selftest(cfg: Config, state: RunState) -> None:
    from .backtest.selftest import run_engine_selftest
    run_engine_selftest(cfg, state)


def step_brique1(cfg: Config, state: RunState) -> None:
    from .research.pipeline import run_brick_baseline
    run_brick_baseline(cfg, state, "ts_momentum")


def step_brique2(cfg: Config, state: RunState) -> None:
    from .research.pipeline import run_brick_baseline
    run_brick_baseline(cfg, state, "cross_sectional")


def step_brique3(cfg: Config, state: RunState) -> None:
    from .research.pipeline import run_brick_baseline
    run_brick_baseline(cfg, state, "cascade_reversal")


def step_portfolio(cfg: Config, state: RunState) -> None:
    from .research.pipeline import run_portfolio_baseline
    run_portfolio_baseline(cfg, state)


def step_universe_h2(cfg: Config, state: RunState) -> None:
    from .research.universe_study import run_universe_study
    run_universe_study(cfg, state)


def step_research(cfg: Config, state: RunState) -> None:
    from .research.pipeline import run_research_loop
    run_research_loop(cfg, state)


def step_leverage(cfg: Config, state: RunState) -> None:
    from .research.pipeline import run_leverage_calibration
    run_leverage_calibration(cfg, state)


def step_validation_oos(cfg: Config, state: RunState) -> None:
    from .research.pipeline import run_oos_validation
    run_oos_validation(cfg, state)


def step_report(cfg: Config, state: RunState) -> None:
    from .reports.final import build_final_report
    build_final_report(cfg, state)


STEPS: dict[str, Callable[[Config, RunState], None]] = {
    "data_fast": step_data_fast,
    "data_minute": step_data_minute,
    "data_quality": step_data_quality,
    "engine_selftest": step_engine_selftest,
    "brique1": step_brique1,
    "brique2": step_brique2,
    "brique3": step_brique3,
    "portfolio": step_portfolio,
    "universe_h2": step_universe_h2,
    "research": step_research,
    "leverage": step_leverage,
    "validation_oos": step_validation_oos,
    "report": step_report,
}


# ----------------------------------------------------------------------
def print_status(cfg: Config, state: RunState) -> None:
    from .core.persist import read_jsonl
    print(f"\n  phase courante : {state.get('phase')}")
    print(f"  out-of-sample  : {'OUVERT ' + str(state.get('oos_opened_at')) if state.get('oos_opened') else 'scelle'}")
    trials = read_jsonl(cfg.research_root / "research_log.jsonl")
    budget = cfg.get("research.max_trials")
    print(f"  essais consommes : {len(trials)} / {budget}")
    print(f"  hypothese en cours : {state.get('current_hypothesis')}\n")
    for name, desc in PIPELINE:
        mark = "[x]" if state.is_done(f"step:{name}") else "[ ]"
        print(f"  {mark} {name:<16s} {desc}")
    sub = [s for s in state.data["completed_steps"] if s.startswith("dl:")]
    print(f"\n  lots de telechargement termines : {len(sub)}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="okx_algo.run")
    ap.add_argument("--config", default=None)
    ap.add_argument("--resume", action="store_true", help="reprend la sequence complete")
    ap.add_argument("--step", default=None, help="execute une etape precise")
    ap.add_argument("--force", action="store_true", help="rejoue meme si deja terminee")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--until", default=None, help="s'arrete apres cette etape")
    args = ap.parse_args(argv)

    cfg = load_config(args.config)
    state = RunState(cfg.state_root / "run_state.json")
    if state.get("seed") is None:
        state.set("seed", cfg.get("project.seed"))

    if args.status:
        print_status(cfg, state)
        return 0

    setup_logging(cfg, args.step or "run")
    log = logging.getLogger("okx_algo.run")

    if args.step:
        todo = [args.step]
    elif args.resume:
        todo = [n for n, _ in PIPELINE]
    else:
        ap.error("preciser --resume, --step ou --status")
        return 2

    for name in todo:
        if name not in STEPS:
            log.error("etape inconnue: %s", name)
            return 2
        key = f"step:{name}"
        if state.is_done(key) and not args.force:
            log.info("etape %s deja terminee, ignoree", name)
            if args.until and name == args.until:
                break
            continue
        log.info("=== etape %s ===", name)
        state.set("phase", name)
        try:
            STEPS[name](cfg, state)
        except Exception:
            log.error("etape %s ECHOUEE\n%s", name, traceback.format_exc())
            return 1
        state.mark_done(key)
        log.info("=== etape %s terminee ===", name)
        if args.until and name == args.until:
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
