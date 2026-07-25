"""Découpages temporels : walk-forward (§8.2) et purged K-fold (§8.3).

Le purge et l'embargo servent à empêcher un fold d'apprendre sur une
information qui recouvre le fold de test. En trading, deux sources de fuite :

* les **features** regardent en arrière (une EMA 200 en 4h porte 33 jours
  d'historique) — le début du test doit donc être purgé ;
* les **trades** durent (jusqu'à 5 jours ici) — un trade ouvert dans le train
  peut se dénouer dans le test.

L'embargo couvre les deux : sa longueur par défaut est ``max(warmup,
horizon max de trade)``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import Config
from ..features.pipeline import effective_warmup
from ..utils import get_logger, timeframe_to_timedelta, to_utc

log = get_logger("validation.splits")


@dataclass
class Window:
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp
    label: str = ""

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "train_start": str(self.train_start), "train_end": str(self.train_end),
            "test_start": str(self.test_start), "test_end": str(self.test_end),
            "train_days": (self.train_end - self.train_start).days,
            "test_days": (self.test_end - self.test_start).days,
        }


def embargo_timedelta(cfg: Config) -> pd.Timedelta:
    """Marge de sécurité entre train et test."""
    exec_tf = str(cfg.get_path("data.execution_timeframe"))
    warmup = effective_warmup(cfg) * timeframe_to_timedelta(exec_tf)
    holding = pd.Timedelta(days=float(cfg.get_path("risk.max_holding_days")))
    return max(warmup, holding)


def walk_forward_windows(
    start,
    end,
    cfg: Config,
    mode: str = "anchored",
    train_months: int | None = None,
    test_months: int | None = None,
) -> list[Window]:
    """Fenêtres glissantes ou ancrées, avec embargo entre train et test."""
    start, end = to_utc(start), to_utc(end)
    train_months = int(train_months or cfg.get_path("validation.walk_forward.train_months"))
    test_months = int(test_months or cfg.get_path("validation.walk_forward.test_months"))
    embargo = embargo_timedelta(cfg)

    windows: list[Window] = []
    train_start = start
    train_end = start + pd.DateOffset(months=train_months)
    i = 0
    while True:
        test_start = to_utc(train_end + embargo)
        test_end = to_utc(test_start + pd.DateOffset(months=test_months))
        if test_start >= end:
            break
        test_end = min(test_end, end)
        windows.append(
            Window(
                train_start=to_utc(train_start), train_end=to_utc(train_end),
                test_start=test_start, test_end=test_end, label=f"{mode}_{i:02d}",
            )
        )
        i += 1
        train_end = to_utc(train_end + pd.DateOffset(months=test_months))
        if mode == "rolling":
            train_start = to_utc(train_start + pd.DateOffset(months=test_months))
        if train_end >= end:
            break
    return windows


def purged_kfold_windows(
    start,
    end,
    cfg: Config,
    n_splits: int | None = None,
    embargo_pct: float | None = None,
) -> list[Window]:
    """K-fold temporel purgé : le train exclut la zone contaminée autour du test.

    Chaque fold renvoie **une** fenêtre de test contiguë ; les segments de train
    sont ceux qui restent une fois retirés le fold et son embargo (l'appelant
    les reconstruit avec ``train_segments``).
    """
    start, end = to_utc(start), to_utc(end)
    n_splits = int(n_splits or cfg.get_path("validation.purged_kfold.n_splits"))
    embargo_pct = float(embargo_pct if embargo_pct is not None
                        else cfg.get_path("validation.purged_kfold.embargo_pct"))
    total = end - start
    fold = total / n_splits
    embargo = max(embargo_timedelta(cfg), total * embargo_pct)

    windows = []
    for k in range(n_splits):
        test_start = start + k * fold
        test_end = start + (k + 1) * fold
        windows.append(
            Window(train_start=start, train_end=end, test_start=to_utc(test_start),
                   test_end=to_utc(test_end), label=f"fold_{k}")
        )
    return windows


def train_segments(window: Window, cfg: Config) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """Segments d'entraînement d'un fold purgé (avant et après la zone de test)."""
    embargo = embargo_timedelta(cfg)
    segments = []
    if window.test_start - embargo > window.train_start:
        segments.append((window.train_start, window.test_start - embargo))
    if window.test_end + embargo < window.train_end:
        segments.append((window.test_end + embargo, window.train_end))
    return segments


def describe_windows(windows: list[Window]) -> pd.DataFrame:
    return pd.DataFrame([w.as_dict() for w in windows])
