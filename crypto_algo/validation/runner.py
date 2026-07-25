"""Exécution des backtests de validation : grilles, walk-forward, k-fold purgé.

Chaque backtest exécuté ici s'enregistre dans le ``TrialRegistry`` : le nombre
d'essais utilisé par le Deflated Sharpe Ratio est donc **compté
automatiquement**, y compris les configurations perdantes.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np
import pandas as pd

from ..backtest.engine import BacktestEngine, BacktestResult
from ..config import Config
from ..data.loader import MarketData
from ..reports.metrics import compute_metrics
from ..strategies.composite import RoutedMultiFamilyStrategy
from ..utils import get_logger, to_utc
from .deflated_sharpe import TrialRegistry
from .splits import Window, purged_kfold_windows, train_segments, walk_forward_windows

log = get_logger("validation.runner")

# paramètres explorés par défaut : peu nombreux et interprétables.
# Une grille large sur beaucoup d'axes ne « trouve » qu'un pic de surajustement.
DEFAULT_GRID = {
    "entry_threshold": [0.25, 0.35, 0.45],
    "atr_stop_mult": [1.5, 2.0, 3.0],
    "min_families_agreeing": [2, 3],
}


@dataclass
class RunOutcome:
    params: dict[str, Any]
    metrics: dict[str, Any]
    equity: pd.Series = field(repr=False, default_factory=lambda: pd.Series(dtype=float))
    trades: pd.DataFrame = field(repr=False, default_factory=pd.DataFrame)
    stats: dict[str, Any] = field(repr=False, default_factory=dict)

    @property
    def sharpe(self) -> float:
        return float(self.metrics.get("sharpe", float("nan")))


class ValidationRunner:
    def __init__(
        self,
        cfg: Config,
        market_data: MarketData,
        registry: TrialRegistry | None = None,
        cost_stress: float = 1.0,
        shared_cache: dict | None = None,
    ):
        self.cfg = cfg
        self.md = market_data
        self.registry = registry
        self.cost_stress = cost_stress
        # Le cache peut être partagé entre plusieurs runners : features, scores
        # de familles et régimes ne dépendent ni du risque par trade ni des
        # seuils d'entrée. Sans partage, une étude à 5 niveaux de risque
        # recalcule 5 fois les mêmes 200 colonnes de features.
        self._cache_by_window: dict[tuple, dict] = shared_cache if shared_cache is not None else {}

    # ------------------------------------------------------------------ unitaire
    def run_once(
        self,
        params: dict[str, Any] | None = None,
        start=None,
        end=None,
        cache_key: tuple | None = None,
        label: str = "run",
        record: bool = True,
    ) -> RunOutcome:
        params = dict(params or {})
        pad_start = start
        if start is not None:
            pad_start = to_utc(start) - self._warmup_pad()
        md = self.md.slice(pad_start, end) if (start is not None or end is not None) else self.md
        key = cache_key if cache_key is not None else (to_utc(start), to_utc(end))
        cache = self._cache_by_window.setdefault(key, {})

        strategy = RoutedMultiFamilyStrategy(self.cfg, core_cache=cache, **params)
        result = BacktestEngine(self.cfg, md, strategy, cost_stress=self.cost_stress).run()

        # on ne mesure que la fenêtre demandée : le pré-chargement de warmup
        # ne doit pas apparaître dans les métriques ni dans la courbe recollée
        equity = result.equity["equity"]
        trades = result.trades
        if start is not None:
            s = to_utc(start)
            equity = equity[equity.index >= s]
            if len(trades):
                trades = trades[pd.to_datetime(trades["opened_at"]) >= s].reset_index(drop=True)
        report = compute_metrics(
            equity, trades, stats=result.stats,
            days_per_year=int(self.cfg.get_path("reports.annualization_days")), name=label,
        )
        if record and self.registry is not None:
            self.registry.record(label, params, report.metrics.get("sharpe", float("nan")),
                                 report.metrics.get("trades", 0), md.split)
        return RunOutcome(params=params, metrics=report.metrics,
                          equity=equity, trades=trades, stats=result.stats)

    def _warmup_pad(self) -> pd.Timedelta:
        from ..features.pipeline import effective_warmup
        from ..utils import timeframe_to_timedelta

        return effective_warmup(self.cfg) * timeframe_to_timedelta(
            str(self.cfg.get_path("data.execution_timeframe"))
        )

    # -------------------------------------------------------------------- grille
    def grid(self, grid: dict[str, Iterable] | None = None, start=None, end=None,
             label: str = "grid") -> list[RunOutcome]:
        grid = grid or DEFAULT_GRID
        keys = list(grid)
        outcomes = []
        combos = list(itertools.product(*[list(grid[k]) for k in keys]))
        log.info("Grille : %d combinaisons sur %s -> %s", len(combos), start, end)
        for i, values in enumerate(combos):
            params = dict(zip(keys, values))
            outcome = self.run_once(params, start, end, cache_key=(to_utc(start), to_utc(end)),
                                    label=f"{label}_{i:03d}")
            outcomes.append(outcome)
        return outcomes

    @staticmethod
    def best_of(outcomes: list[RunOutcome], criterion: str = "sharpe",
                min_trades: int = 20) -> RunOutcome | None:
        eligible = [o for o in outcomes if o.metrics.get("trades", 0) >= min_trades]
        pool = eligible or outcomes
        if not pool:
            return None
        return max(pool, key=lambda o: (o.metrics.get(criterion, float("-inf"))
                                        if np.isfinite(o.metrics.get(criterion, np.nan)) else float("-inf")))

    # ------------------------------------------------------------- walk-forward
    def walk_forward(
        self,
        start,
        end,
        mode: str = "anchored",
        grid: dict[str, Iterable] | None = None,
        criterion: str = "sharpe",
    ) -> dict[str, Any]:
        """Réoptimisation à chaque pas, évaluation sur la fenêtre suivante."""
        windows = walk_forward_windows(start, end, self.cfg, mode=mode)
        rows, test_equities, test_trades = [], [], []
        for window in windows:
            train_runs = self.grid(grid, window.train_start, window.train_end,
                                   label=f"wf_{mode}_{window.label}_train")
            best = self.best_of(train_runs, criterion)
            if best is None:
                continue
            test = self.run_once(best.params, window.test_start, window.test_end,
                                 label=f"wf_{mode}_{window.label}_test")
            rows.append(
                {
                    **window.as_dict(),
                    "mode": mode,
                    "params": str(best.params),
                    f"train_{criterion}": best.metrics.get(criterion),
                    "train_trades": best.metrics.get("trades"),
                    f"test_{criterion}": test.metrics.get(criterion),
                    "test_trades": test.metrics.get("trades"),
                    "test_return": test.metrics.get("total_return"),
                    "test_max_dd": test.metrics.get("max_drawdown"),
                }
            )
            if len(test.equity):
                test_equities.append(test.equity)
            if len(test.trades):
                test_trades.append(test.trades)

        stitched = self._stitch(test_equities)
        table = pd.DataFrame(rows)
        degradation = float("nan")
        if not table.empty:
            tr = table[f"train_{criterion}"].astype(float)
            te = table[f"test_{criterion}"].astype(float)
            mask = np.isfinite(tr) & np.isfinite(te)
            if mask.any():
                degradation = float(te[mask].mean() - tr[mask].mean())
        return {
            "mode": mode,
            "windows": table,
            "equity": stitched,
            "trades": pd.concat(test_trades, ignore_index=True) if test_trades else pd.DataFrame(),
            "degradation": degradation,
        }

    # --------------------------------------------------------- k-fold purgé
    def purged_kfold(self, start, end, grid: dict[str, Iterable] | None = None,
                     criterion: str = "sharpe") -> pd.DataFrame:
        """Le train exclut le fold de test **et** sa zone d'embargo."""
        windows = purged_kfold_windows(start, end, self.cfg)
        rows = []
        for window in windows:
            segments = train_segments(window, self.cfg)
            train_runs: list[RunOutcome] = []
            for seg_start, seg_end in segments:
                train_runs.extend(
                    self.grid(grid, seg_start, seg_end, label=f"kfold_{window.label}_train")
                )
            best = self.best_of(train_runs, criterion)
            if best is None:
                continue
            test = self.run_once(best.params, window.test_start, window.test_end,
                                 label=f"kfold_{window.label}_test")
            rows.append(
                {
                    "fold": window.label,
                    "test_start": str(window.test_start), "test_end": str(window.test_end),
                    "train_segments": len(segments),
                    "params": str(best.params),
                    f"train_{criterion}": best.metrics.get(criterion),
                    f"test_{criterion}": test.metrics.get(criterion),
                    "test_trades": test.metrics.get("trades"),
                    "test_return": test.metrics.get("total_return"),
                }
            )
        return pd.DataFrame(rows)

    # -------------------------------------------------------------- utilitaires
    @staticmethod
    def _stitch(equities: list[pd.Series]) -> pd.Series:
        """Recolle les courbes de test en une seule, en rendements composés."""
        if not equities:
            return pd.Series(dtype=float)
        pieces, level = [], 1.0
        for eq in equities:
            if len(eq) < 2 or eq.iloc[0] <= 0:
                continue
            normalized = eq / eq.iloc[0]
            pieces.append(normalized * level)
            level = float(pieces[-1].iloc[-1])
        if not pieces:
            return pd.Series(dtype=float)
        return pd.concat(pieces).sort_index()
