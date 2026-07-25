"""Registre d'essais (§16.2) — automatique, append-only, non modifiable.

Une ligne par configuration testee, ecrite par le moteur, jamais a la main.
Le compteur alimente directement la penalite du Deflated Sharpe : plus on
teste, plus la barre monte. Un essai fait est un essai compte, meme s'il etait
« juste pour voir ».

Le registre est aussi le mecanisme de reprise : `already_run` permet de rejouer
une session interrompue sans reconsommer du budget ni dupliquer des lignes.
"""
from __future__ import annotations

import datetime as dt
import logging
from pathlib import Path

from ..core.persist import append_jsonl, read_jsonl, stable_hash

log = logging.getLogger("okx_algo.registry")


class TrialBudgetExhausted(RuntimeError):
    """Budget de 200 configurations epuise : arret en echec (§16.5)."""


class ResearchRegistry:
    def __init__(self, path: str | Path, max_trials: int):
        self.path = Path(path)
        self.max_trials = int(max_trials)
        self._rows = read_jsonl(self.path)
        self._by_key = {r.get("params_hash"): r for r in self._rows if r.get("params_hash")}

    # ------------------------------------------------------------------
    @property
    def n_trials(self) -> int:
        """Nombre d'essais consommes. Ne repart JAMAIS de zero (§17.4.3)."""
        return len(self._rows)

    @property
    def remaining(self) -> int:
        return max(self.max_trials - self.n_trials, 0)

    def rows(self) -> list[dict]:
        return list(self._rows)

    def already_run(self, hypothesis: str, params: dict) -> dict | None:
        return self._by_key.get(self._key(hypothesis, params))

    @staticmethod
    def _key(hypothesis: str, params: dict) -> str:
        return stable_hash({"h": hypothesis, "p": params})

    # ------------------------------------------------------------------
    def record(self, hypothesis: str, params: dict, metrics: dict,
               status: str, note: str = "") -> dict:
        """Ecrit une ligne. Idempotent sur (hypothese, parametres)."""
        key = self._key(hypothesis, params)
        existing = self._by_key.get(key)
        if existing is not None:
            log.info("essai deja enregistre (%s), aucune ligne ajoutee", hypothesis)
            return existing

        if self.n_trials >= self.max_trials and hypothesis != "baseline":
            raise TrialBudgetExhausted(
                f"budget de {self.max_trials} configurations epuise "
                f"({self.n_trials} consommees) — arret en echec au sens du §16.5")

        row = {
            "trial_id": self.n_trials + 1,
            "hypothesis": hypothesis,
            "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
            "params": params,
            "params_hash": key,
            "is_sharpe": _f(metrics.get("sharpe")),
            "is_monthly_return": _f(metrics.get("monthly_return_median")),
            "is_monthly_return_mean": _f(metrics.get("monthly_return_mean")),
            "max_drawdown": _f(metrics.get("max_drawdown")),
            "calmar": _f(metrics.get("calmar")),
            "n_trades": int(metrics.get("n_trades") or 0),
            "costs_pct_of_gross_pnl": _f(metrics.get("costs_pct_of_gross_pnl")),
            "n_liquidations": int(metrics.get("n_liquidations") or 0),
            "status": status,
            "note": note,
        }
        append_jsonl(self.path, row)
        self._rows.append(row)
        self._by_key[key] = row
        log.info("essai %d [%s] sharpe=%.3f mensuel=%.4f trades=%d -> %s",
                 row["trial_id"], hypothesis, row["is_sharpe"] or 0.0,
                 row["is_monthly_return"] or 0.0, row["n_trades"], status)
        return row

    # ------------------------------------------------------------------
    def best(self, key: str = "is_sharpe") -> dict | None:
        valid = [r for r in self._rows if r.get(key) is not None
                 and r.get("status") != "invalid"]
        return max(valid, key=lambda r: r[key]) if valid else None

    def sharpes(self) -> list[float]:
        return [r["is_sharpe"] for r in self._rows if r.get("is_sharpe") is not None]

    def summary(self) -> dict:
        by_hyp: dict[str, int] = {}
        for r in self._rows:
            by_hyp[r["hypothesis"]] = by_hyp.get(r["hypothesis"], 0) + 1
        return {"n_trials": self.n_trials, "max_trials": self.max_trials,
                "remaining": self.remaining, "by_hypothesis": by_hyp}


def _f(v) -> float | None:
    try:
        f = float(v)
        return f if f == f and abs(f) != float("inf") else None
    except (TypeError, ValueError):
        return None
