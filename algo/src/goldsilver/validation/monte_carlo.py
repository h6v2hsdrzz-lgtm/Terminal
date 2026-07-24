"""Monte-Carlo sur les trades : reshuffle (permutation) et bootstrap.

- **Permutation** : mêmes trades, ordre aléatoire -> distribution des chemins
  d'equity. Montre à quel point la belle courbe dépend de l'ORDRE historique
  des gains/pertes (qui ne se reproduira pas).
- **Bootstrap** : tirage avec remise -> variantes plausibles de l'échantillon
  de trades ; incertitude sur l'espérance elle-même.

Sorties : distribution du rendement final, du max drawdown, probabilité de
« ruine » (drawdown >= seuil config) et de finir perdant.

Hypothèse assumée : les trades sont composés séquentiellement via leur
``pnl_pct`` (rendement sur l'equity à l'entrée). Les chevauchements
or/argent sont donc approximés — précis tant que le risque par trade reste
petit, ce qui est le cas ici (<= 1 %).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from goldsilver.config import MonteCarloConfig


@dataclass(frozen=True)
class MonteCarloDistribution:
    final_returns: np.ndarray       # rendement total par chemin (fraction)
    max_drawdowns: np.ndarray       # max DD par chemin (fraction positive)
    p_ruin: float                   # P(max DD >= ruin_drawdown)
    p_loss: float                   # P(rendement final < 0)
    ret_p5: float
    ret_p50: float
    ret_p95: float
    dd_p50: float
    dd_p95: float
    sample_paths: np.ndarray        # quelques chemins pour le graphique (n, T)


@dataclass(frozen=True)
class MonteCarloResult:
    n_trades: int
    ruin_drawdown: float
    shuffle: MonteCarloDistribution
    bootstrap: MonteCarloDistribution


def _simulate(returns: np.ndarray, picks: np.ndarray, ruin_dd: float,
              n_sample_paths: int) -> MonteCarloDistribution:
    """``picks`` : matrice (n_runs, n_trades) d'indices dans ``returns``."""
    r = returns[picks]                                  # (runs, trades)
    equity = np.cumprod(1.0 + r, axis=1)
    peak = np.maximum.accumulate(equity, axis=1)
    dd = 1.0 - equity / peak
    max_dd = dd.max(axis=1)
    final = equity[:, -1] - 1.0
    return MonteCarloDistribution(
        final_returns=final,
        max_drawdowns=max_dd,
        p_ruin=float((max_dd >= ruin_dd).mean()),
        p_loss=float((final < 0).mean()),
        ret_p5=float(np.percentile(final, 5)),
        ret_p50=float(np.percentile(final, 50)),
        ret_p95=float(np.percentile(final, 95)),
        dd_p50=float(np.percentile(max_dd, 50)),
        dd_p95=float(np.percentile(max_dd, 95)),
        sample_paths=equity[:n_sample_paths],
    )


def run_monte_carlo(
    trades: pd.DataFrame,
    mc_cfg: MonteCarloConfig,
    seed: int,
    n_sample_paths: int = 100,
) -> MonteCarloResult:
    if len(trades) < 5:
        raise ValueError(f"Monte-Carlo : seulement {len(trades)} trades, trop peu")
    returns = trades["pnl_pct"].to_numpy(dtype=np.float64)
    n = len(returns)
    rng = np.random.default_rng(seed)

    shuffle_picks = np.argsort(rng.random((mc_cfg.n_runs, n)), axis=1)
    boot_picks = rng.integers(0, n, size=(mc_cfg.n_runs, n))

    return MonteCarloResult(
        n_trades=n,
        ruin_drawdown=mc_cfg.ruin_drawdown,
        shuffle=_simulate(returns, shuffle_picks, mc_cfg.ruin_drawdown, n_sample_paths),
        bootstrap=_simulate(returns, boot_picks, mc_cfg.ruin_drawdown, n_sample_paths),
    )
