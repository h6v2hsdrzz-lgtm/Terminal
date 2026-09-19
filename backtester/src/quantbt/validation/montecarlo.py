"""Monte-Carlo resampling of trade returns: equity/drawdown distributions and
risk of ruin.

Two schemes over per-trade percentage returns:
- shuffle: same trades, random order — isolates sequence risk (drawdowns).
- bootstrap: resample with replacement — also varies the trade mix.

Position sizing is compounded (each trade return applies to current equity),
matching the fixed-fractional sizing of the engine.
"""

from __future__ import annotations

import numpy as np

from quantbt.config import MonteCarloConfig
from quantbt.engine.backtester import BacktestResult
from quantbt.validation.common import Flag, ValidationOutcome

PERCENTILES = [5, 25, 50, 75, 95]


def _simulate(returns: np.ndarray, n_runs: int, rng: np.random.Generator,
              bootstrap: bool) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (final_equity, max_dd, paths_sample) for n_runs simulations."""
    n = len(returns)
    finals = np.empty(n_runs)
    maxdds = np.empty(n_runs)
    sample_paths = []
    for k in range(n_runs):
        if bootstrap:
            seq = returns[rng.integers(0, n, size=n)]
        else:
            seq = rng.permutation(returns)
        equity = np.cumprod(1.0 + seq)
        peak = np.maximum.accumulate(np.concatenate(([1.0], equity)))[1:]
        dd = equity / peak - 1.0
        finals[k] = equity[-1]
        maxdds[k] = dd.min()
        if k < 100:  # keep a subsample of paths for plotting
            sample_paths.append(np.concatenate(([1.0], equity)))
    return finals, maxdds, np.array(sample_paths)


def run_montecarlo(result: BacktestResult, cfg: MonteCarloConfig) -> ValidationOutcome:
    trades = result.trades
    if len(trades) < 10:
        return ValidationOutcome(
            module="montecarlo",
            flags=[Flag("montecarlo.sample", "warn",
                        f"only {len(trades)} trades — Monte-Carlo not meaningful", len(trades))],
            payload={},
        )

    returns = trades["return_pct"].to_numpy(float)
    rng = np.random.default_rng(cfg.seed)
    payload: dict = {}
    flags: list[Flag] = []

    methods = ["shuffle", "bootstrap"] if cfg.method == "both" else [cfg.method]
    for method in methods:
        finals, maxdds, paths = _simulate(returns, cfg.n_runs, rng, method == "bootstrap")
        ruin_prob = float(np.mean(finals < cfg.ruin_threshold))
        payload[method] = {
            "final_equity_pct": {p: float(np.percentile(finals, p)) for p in PERCENTILES},
            "max_dd_pct": {p: float(np.percentile(maxdds, p)) for p in PERCENTILES},
            "risk_of_ruin": ruin_prob,
            "prob_loss": float(np.mean(finals < 1.0)),
            "paths": paths,
            "finals": finals,
            "maxdds": maxdds,
        }

    ref = payload[methods[0]]
    ruin = max(payload[m]["risk_of_ruin"] for m in methods)
    p5_final = ref["final_equity_pct"][5]
    p95_dd = ref["max_dd_pct"][5]  # 5th percentile of maxdd = worst tail

    if ruin > 0.05:
        flags.append(Flag("montecarlo.ruin", "fail",
                          f"risk of ruin {ruin:.1%} (equity < {cfg.ruin_threshold:.0%} of start)", ruin))
    elif ruin > 0.01:
        flags.append(Flag("montecarlo.ruin", "warn", f"risk of ruin {ruin:.1%}", ruin))
    else:
        flags.append(Flag("montecarlo.ruin", "pass", f"risk of ruin {ruin:.1%}", ruin))

    if p5_final < 1.0:
        flags.append(Flag("montecarlo.tail", "warn",
                          f"5th percentile of final equity is {p5_final:.2f}x — "
                          f"worst-tail drawdown {p95_dd:.0%}", p5_final))
    else:
        flags.append(Flag("montecarlo.tail", "pass",
                          f"5th percentile final equity {p5_final:.2f}x, tail DD {p95_dd:.0%}",
                          p5_final))

    return ValidationOutcome(module="montecarlo", flags=flags, payload=payload)
