"""Deflated Sharpe Ratio et correction pour tests multiples (§8.6).

Un Sharpe obtenu après avoir essayé 200 configurations n'a pas la même valeur
qu'un Sharpe obtenu du premier coup. Le DSR (Bailey & López de Prado) corrige
le Sharpe observé par :

* le **nombre d'essais** (le maximum de N tirages bruités est biaisé à la hausse),
* la **longueur** de l'échantillon,
* l'**asymétrie** et le **kurtosis** des rendements (une stratégie qui gagne
  souvent un peu et perd rarement beaucoup a un Sharpe trompeur).

Le compteur d'essais est tenu automatiquement par ``TrialRegistry`` : chaque
backtest exécuté pendant la recherche s'y enregistre. On ne peut donc pas
« oublier » les configurations perdantes au moment de conclure.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from ..utils import ensure_dir, get_logger

log = get_logger("validation.dsr")
EULER_MASCHERONI = 0.5772156649015329


@dataclass
class TrialRegistry:
    """Journal persistant des configurations testées."""

    path: Path
    trials: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def load(cls, path: str | Path) -> "TrialRegistry":
        p = Path(path)
        trials = []
        if p.exists():
            with open(p, "r", encoding="utf-8") as fh:
                trials = json.load(fh)
        return cls(path=p, trials=trials)

    def record(self, name: str, params: dict[str, Any], sharpe: float, trades: int, split: str) -> None:
        self.trials.append(
            {
                "name": name,
                "params": {k: (v if isinstance(v, (int, float, str, bool)) else str(v))
                           for k, v in params.items()},
                "sharpe": float(sharpe) if np.isfinite(sharpe) else None,
                "trades": int(trades),
                "split": split,
                "ts": pd.Timestamp.now("UTC").isoformat(),
            }
        )
        self.flush()

    def flush(self) -> None:
        ensure_dir(self.path.parent)
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(self.trials, fh, indent=2)

    @property
    def n_trials(self) -> int:
        return len(self.trials)

    def sharpes(self) -> np.ndarray:
        return np.array([t["sharpe"] for t in self.trials if t["sharpe"] is not None], dtype=float)

    def frame(self) -> pd.DataFrame:
        return pd.DataFrame(self.trials)


def expected_max_sharpe(n_trials: int, sharpe_variance: float) -> float:
    """Sharpe attendu du **meilleur** de N essais purement bruités."""
    if n_trials <= 1:
        return 0.0
    sd = np.sqrt(max(sharpe_variance, 1e-12))
    e = (1 - EULER_MASCHERONI) * stats.norm.ppf(1 - 1.0 / n_trials) + \
        EULER_MASCHERONI * stats.norm.ppf(1 - 1.0 / (n_trials * np.e))
    return float(sd * e)


def probabilistic_sharpe_ratio(
    observed_sharpe: float,
    benchmark_sharpe: float,
    n_obs: int,
    skew: float = 0.0,
    kurtosis: float = 3.0,
) -> float:
    """PSR : probabilité que le vrai Sharpe dépasse ``benchmark_sharpe``."""
    if n_obs < 3 or not np.isfinite(observed_sharpe):
        return float("nan")
    denom = np.sqrt(
        max(1e-12, 1 - skew * observed_sharpe + ((kurtosis - 1) / 4.0) * observed_sharpe ** 2)
    )
    z = (observed_sharpe - benchmark_sharpe) * np.sqrt(n_obs - 1) / denom
    return float(stats.norm.cdf(z))


def deflated_sharpe_ratio(
    returns: pd.Series,
    n_trials: int,
    trial_sharpes: np.ndarray | None = None,
    periods_per_year: int = 365,
) -> dict[str, float]:
    """DSR = PSR évalué contre le Sharpe attendu du meilleur de N essais."""
    r = pd.Series(returns).dropna()
    n = len(r)
    if n < 10:
        return {"sharpe": float("nan"), "dsr": float("nan"), "n_trials": n_trials, "n_obs": n}

    sr_period = float(r.mean() / r.std(ddof=1)) if r.std(ddof=1) > 0 else float("nan")
    sr_annual = sr_period * np.sqrt(periods_per_year)
    skew = float(stats.skew(r))
    kurt = float(stats.kurtosis(r, fisher=False))

    if trial_sharpes is not None and len(trial_sharpes) > 1:
        var_sharpe = float(np.var(trial_sharpes / np.sqrt(periods_per_year), ddof=1))
    else:
        # variance théorique d'un Sharpe estimé sur n observations
        var_sharpe = (1 + 0.5 * sr_period ** 2) / max(n - 1, 1)

    sr0 = expected_max_sharpe(n_trials, var_sharpe)
    dsr = probabilistic_sharpe_ratio(sr_period, sr0, n, skew, kurt)
    min_track_record = _min_track_record_length(sr_period, sr0, skew, kurt)

    return {
        "sharpe": sr_annual,
        "sharpe_period": sr_period,
        "expected_max_sharpe_period": sr0,
        "expected_max_sharpe_annual": sr0 * np.sqrt(periods_per_year),
        "dsr": dsr,
        "psr_vs_zero": probabilistic_sharpe_ratio(sr_period, 0.0, n, skew, kurt),
        "skew": skew,
        "kurtosis": kurt,
        "n_trials": int(n_trials),
        "n_obs": int(n),
        "min_track_record_days": min_track_record,
    }


def _min_track_record_length(sr: float, sr0: float, skew: float, kurt: float, confidence: float = 0.95) -> float:
    """Nombre d'observations nécessaires pour que le Sharpe soit significatif."""
    if not np.isfinite(sr) or sr <= sr0:
        return float("inf")
    z = stats.norm.ppf(confidence)
    num = 1 - skew * sr + ((kurt - 1) / 4.0) * sr ** 2
    return float(1 + num * (z / (sr - sr0)) ** 2)
