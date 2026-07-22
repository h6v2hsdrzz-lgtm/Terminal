"""Sensibilité aux paramètres : pic fragile ou plateau robuste ?

Pour chaque paire de paramètres configurée, on balaie une grille 2D (toutes
les autres valeurs aux défauts) et on mesure la métrique choisie. Un bon jeu
de paramètres vit sur un PLATEAU : les voisins immédiats performent presque
aussi bien. Un pic isolé — le point choisi est bon, ses voisins mauvais —
est la signature d'un paramètre ajusté au bruit.

Score de plateau d'une cellule = médiane de la métrique sur le voisinage
3x3, rapportée à la valeur de la cellule (borné à [0, 1] quand la cellule
est positive). Le score global est celui de la cellule des paramètres
par défaut de la config.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Mapping

import numpy as np
import pandas as pd

from goldsilver.config import Config
from goldsilver.pipeline import run_backtest

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class SensitivityMap:
    param_x: str
    param_y: str
    x_values: list[float]
    y_values: list[float]
    metric: str
    grid: np.ndarray             # (len(y), len(x))
    n_trades: np.ndarray
    default_cell: tuple[int, int] | None   # (iy, ix) des paramètres par défaut
    plateau_score: float
    positive_frac: float         # fraction de la grille > 0


@dataclass(frozen=True)
class SensitivityResult:
    maps: list[SensitivityMap]
    plateau_score: float         # min des scores (le maillon faible)


def _metric_value(metrics, name: str) -> float:
    val = getattr(metrics, name)
    return float(val) if np.isfinite(val) else np.nan


def _plateau_score(grid: np.ndarray, cell: tuple[int, int] | None) -> float:
    if cell is None:
        return float("nan")
    iy, ix = cell
    y0, y1 = max(0, iy - 1), min(grid.shape[0], iy + 2)
    x0, x1 = max(0, ix - 1), min(grid.shape[1], ix + 2)
    neigh = grid[y0:y1, x0:x1]
    neigh = neigh[np.isfinite(neigh)]
    center = grid[iy, ix]
    if not np.isfinite(center) or len(neigh) == 0:
        return float("nan")
    if center <= 0:
        return 0.0
    return float(np.clip(np.median(neigh) / center, 0.0, 1.0))


def run_sensitivity(market: Mapping[str, pd.DataFrame], cfg: Config) -> SensitivityResult:
    s = cfg.validation.sensitivity
    maps: list[SensitivityMap] = []
    for px, py in s.pairs:
        xs = [float(v) for v in s.ranges[px]]
        ys = [float(v) for v in s.ranges[py]]
        grid = np.full((len(ys), len(xs)), np.nan)
        ntr = np.zeros((len(ys), len(xs)), dtype=int)
        for iy, vy in enumerate(ys):
            for ix, vx in enumerate(xs):
                override = {px: _cast_like(cfg.strategy.params.get(px), vx),
                            py: _cast_like(cfg.strategy.params.get(py), vy)}
                rr = run_backtest(market, cfg, override)
                grid[iy, ix] = _metric_value(rr.metrics, s.metric)
                ntr[iy, ix] = rr.metrics.n_trades
            log.info("Sensibilité %s x %s : ligne %d/%d", px, py, iy + 1, len(ys))

        cell = _default_cell(cfg, px, py, xs, ys)
        maps.append(
            SensitivityMap(
                param_x=px, param_y=py, x_values=xs, y_values=ys,
                metric=s.metric, grid=grid, n_trades=ntr,
                default_cell=cell,
                plateau_score=_plateau_score(grid, cell),
                positive_frac=float((grid[np.isfinite(grid)] > 0).mean()),
            )
        )

    scores = [m.plateau_score for m in maps if np.isfinite(m.plateau_score)]
    return SensitivityResult(
        maps=maps,
        plateau_score=min(scores) if scores else float("nan"),
    )


def _cast_like(reference, value: float):
    """Garde le type d'origine du paramètre (int pour trend_ema, etc.)."""
    if isinstance(reference, int) and not isinstance(reference, bool):
        return int(value)
    return value


def _default_cell(
    cfg: Config, px: str, py: str, xs: list[float], ys: list[float]
) -> tuple[int, int] | None:
    try:
        vx = float(cfg.strategy.params[px])
        vy = float(cfg.strategy.params[py])
    except (KeyError, TypeError, ValueError):
        return None
    if vx in xs and vy in ys:
        return ys.index(vy), xs.index(vx)
    return None
