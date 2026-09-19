"""Parameter sensitivity: scan a 2-D parameter grid and judge peak vs plateau.

Robust strategies live on plateaus: neighbouring parameter values perform
similarly. A single sharp peak surrounded by mediocrity is the geometry of
overfitting.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from quantbt.config import CostConfig, RiskConfig, SensitivityConfig
from quantbt.data.loader import MarketData
from quantbt.strategy.base import Strategy
from quantbt.validation.common import Flag, ValidationOutcome, evaluate, get_grid


def run_sensitivity(
    data: MarketData,
    strategy: Strategy,
    costs: CostConfig,
    risk: RiskConfig,
    cfg: SensitivityConfig,
    param_grid: dict | None = None,
) -> ValidationOutcome:
    grid = get_grid(strategy, param_grid or {})
    names = list(cfg.params) if cfg.params else sorted(grid)[:2]
    if len(names) < 2 or any(p not in grid for p in names):
        return ValidationOutcome(
            module="sensitivity",
            flags=[Flag("sensitivity.config", "warn",
                        f"need 2 grid params, got {names} (grid keys: {sorted(grid)})", None)],
            payload={},
        )
    p1, p2 = names[0], names[1]
    v1, v2 = grid[p1], grid[p2]

    mat = np.full((len(v1), len(v2)), np.nan)
    for i, a in enumerate(v1):
        for j, b in enumerate(v2):
            m = evaluate(data, strategy.with_params(**{p1: a, p2: b}), costs, risk)
            mat[i, j] = getattr(m, cfg.metric)

    heat = pd.DataFrame(mat, index=[str(v) for v in v1], columns=[str(v) for v in v2])
    heat.index.name, heat.columns.name = p1, p2

    bi, bj = np.unravel_index(np.nanargmax(mat), mat.shape)
    best = float(mat[bi, bj])
    neigh = _neighbors(mat, int(bi), int(bj))
    med_neigh = float(np.nanmedian(neigh)) if len(neigh) else float("nan")
    frac_positive = float(np.nanmean(mat > 0))

    flags: list[Flag] = []
    peaky = (
        best > 0
        and np.isfinite(med_neigh)
        and (med_neigh <= 0 or best / med_neigh > cfg.peak_ratio)
    )
    if frac_positive < 0.3:
        flags.append(Flag("sensitivity.plateau", "fail",
                          f"only {frac_positive:.0%} of the grid has positive {cfg.metric} — "
                          "the edge exists only at cherry-picked parameters", frac_positive))
    elif peaky:
        flags.append(Flag("sensitivity.peak", "warn",
                          f"best cell {best:.2f} vs neighbour median {med_neigh:.2f} — "
                          "fragile peak rather than plateau", best))
    else:
        flags.append(Flag("sensitivity.plateau", "pass",
                          f"{frac_positive:.0%} of grid positive; best {best:.2f} sits on a plateau "
                          f"(neighbour median {med_neigh:.2f})", frac_positive))

    return ValidationOutcome(
        module="sensitivity",
        flags=flags,
        payload={
            "heatmap": heat,
            "params": [p1, p2],
            "best": {"value": best, p1: v1[bi], p2: v2[bj]},
            "neighbour_median": med_neigh,
            "frac_positive": frac_positive,
        },
    )


def _neighbors(mat: np.ndarray, i: int, j: int) -> np.ndarray:
    vals = []
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            if di == dj == 0:
                continue
            a, b = i + di, j + dj
            if 0 <= a < mat.shape[0] and 0 <= b < mat.shape[1]:
                vals.append(mat[a, b])
    return np.array(vals)
