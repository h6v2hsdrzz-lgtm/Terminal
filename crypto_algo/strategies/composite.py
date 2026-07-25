"""Stratégie assemblée : familles de signaux + régime + routage strict (§5).

Chaîne de décision, dans cet ordre et sans raccourci :

1. features multi-TF alignées sur l'instant de disponibilité ;
2. score ``[-1, 1]`` par famille ;
3. classement du régime (4h confirmé par 1h, avec persistance) ;
4. **routage strict** : les familles interdites dans le régime courant sont
   annulées, la direction autorisée est imposée ;
5. hystérésis d'entrée/sortie et exigence d'accord entre familles ;
6. stop obligatoire et objectif, en multiples d'ATR.

Le moteur de risque reste seul maître du dimensionnement et du refus.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import Config
from ..data.loader import MarketData
from ..features.pipeline import FeatureStore
from ..regime.classifier import CHAOS, RegimeClassifier, regime_summary
from ..regime.router import SignalRouter
from ..signals import build_families
from ..signals.base import SignalContext
from ..utils import get_logger
from .base import Strategy

log = get_logger("strategies.composite")


def _hysteresis_state(score: np.ndarray, entry: float, exit_: float) -> np.ndarray:
    """État directionnel avec hystérésis : entrée franche, sortie molle."""
    n = len(score)
    state = np.zeros(n)
    current = 0.0
    for i in range(n):
        s = score[i]
        if not np.isfinite(s):
            s = 0.0
        if current == 0.0:
            if s >= entry:
                current = 1.0
            elif s <= -entry:
                current = -1.0
        else:
            if current > 0 and s < exit_:
                current = 0.0 if s > -entry else -1.0
            elif current < 0 and s > -exit_:
                current = 0.0 if s < entry else 1.0
        state[i] = current
    return state


class RoutedMultiFamilyStrategy(Strategy):
    name = "routed_multi_family"

    def __init__(self, cfg: Config, families: list[str] | None = None,
                 core_cache: dict | None = None, **overrides):
        super().__init__(cfg, **overrides)
        self.family_names = families or list(cfg.get_path("strategy.families"))
        # Cache partagé entre points de grille : features, scores de familles,
        # régimes et routage ne dépendent que des données, pas des seuils
        # d'entrée/sortie. Le recalculer à chaque combinaison multiplierait le
        # temps d'une étude de sensibilité par 20 sans rien changer au résultat.
        self.core_cache = core_cache if core_cache is not None else {}
        self.entry_threshold = float(overrides.get("entry_threshold", cfg.get_path("signals.entry_threshold")))
        self.exit_threshold = float(overrides.get("exit_threshold", cfg.get_path("signals.exit_threshold")))
        self.min_families = int(overrides.get("min_families_agreeing", cfg.get_path("signals.min_families_agreeing")))
        self.atr_stop_mult = float(overrides.get("atr_stop_mult", cfg.get_path("strategy.atr_stop_mult")))
        self.atr_tp_mult = float(overrides.get("atr_tp_mult", cfg.get_path("strategy.atr_tp_mult")))
        self.min_stop_pct = float(cfg.get_path("strategy.min_stop_pct"))
        self.max_stop_pct = float(cfg.get_path("strategy.max_stop_pct"))
        self.use_hysteresis = bool(cfg.get_path("strategy.use_hysteresis"))
        # Contrôle d'inversion : on retourne l'opinion de chaque famille **avant**
        # le routage, donc régimes et contraintes de direction s'appliquent
        # normalement. Si la version inversée gagne nettement, la perte vient
        # d'une erreur de signe et non d'une absence d'edge ; si elle perd aussi,
        # les signaux sont du bruit que les coûts achèvent.
        self.invert_signals = bool(overrides.get("invert_signals", False))
        self.diagnostics: dict[str, pd.DataFrame] = {}
        self.routing_log: dict[str, pd.DataFrame] = {}
        self.regime_shares: dict[str, pd.DataFrame] = {}

    # ------------------------------------------------------------------ prepare
    def prepare(self, md: MarketData, cfg: Config) -> None:
        if self.core_cache.get("ready") and self.core_cache.get("symbols"):
            self._decisions = {
                symbol: self._build_decisions(
                    core["ctx"], core["df"], core["routed"], core["regimes"], core["scores"]
                )
                for symbol, core in self.core_cache["symbols"].items()
            }
            return

        exec_tf = str(cfg.get_path("data.execution_timeframe"))
        benchmark = str(cfg.get_path("universe.benchmark_symbol"))
        store = FeatureStore(cfg)
        features = store.build(md)
        families = build_families(cfg, self.family_names)
        classifier = RegimeClassifier(cfg)
        router = SignalRouter(cfg)
        self.core_cache["symbols"] = {}

        for symbol in md.symbols:
            df = md.get(symbol, exec_tf)
            if df is None or df.empty or symbol not in features:
                self._decisions[symbol] = self.empty_decisions(df.index if df is not None else pd.DatetimeIndex([]))
                continue

            ctx = SignalContext(
                cfg=cfg, symbol=symbol, features=features,
                funding=md.funding, index_price=md.index, benchmark=benchmark,
            )
            scores = {}
            for name, family in families.items():
                try:
                    scores[name] = family.score(ctx)
                except Exception as exc:  # noqa: BLE001
                    log.warning("famille %s indisponible sur %s : %s", name, symbol, exc)
                    scores[name] = pd.Series(0.0, index=df.index)

            if self.invert_signals:
                scores = {name: -s for name, s in scores.items()}

            diagnostics = classifier.classify(ctx)
            regimes = diagnostics.stable
            routed = router.route(regimes, scores)
            # contrôle dur : le routage doit être respecté, sinon on s'arrête
            router.assert_no_forbidden_contribution(routed, regimes)

            self.core_cache["symbols"][symbol] = {
                "ctx": ctx, "df": df, "routed": routed, "regimes": regimes, "scores": scores,
            }
            decisions = self._build_decisions(ctx, df, routed, regimes, scores)
            self._decisions[symbol] = decisions
            diag = diagnostics.frame()
            diag["score"] = routed.score
            diag["signal"] = decisions["signal"]
            for name, s in scores.items():
                diag[f"score_{name}"] = s
            self.diagnostics[symbol] = diag
            self.routing_log[symbol] = routed.log_frame
            self.regime_shares[symbol] = regime_summary(regimes)
            log.info(
                "%s : %d entrées potentielles, régimes %s",
                symbol, int((decisions["signal"].diff().abs() > 0).sum()),
                dict(self.regime_shares[symbol]["share"].round(3)),
            )
        self.core_cache["ready"] = True

    # -------------------------------------------------------------- décisions
    def _build_decisions(self, ctx, df, routed, regimes, scores) -> pd.DataFrame:
        idx = df.index
        cfg = ctx.cfg
        exec_tf = str(cfg.get_path("data.execution_timeframe"))
        dec = self.empty_decisions(idx)
        score = routed.score.reindex(idx).fillna(0.0)

        # --- accord minimal entre familles autorisées ---
        contributions = routed.contributions.reindex(idx).fillna(0.0)
        sign = np.sign(score)
        agreeing = (np.sign(contributions).eq(sign, axis=0) & (contributions.abs() > 0.05)).sum(axis=1)
        enough = agreeing >= self.min_families

        gated = score.where(enough, 0.0)

        if self.use_hysteresis:
            state = _hysteresis_state(gated.to_numpy(float), self.entry_threshold, self.exit_threshold)
        else:
            state = np.where(gated >= self.entry_threshold, 1.0,
                             np.where(gated <= -self.entry_threshold, -1.0, 0.0))
        signal = pd.Series(state, index=idx)

        # --- interdiction absolue en régime chaotique ---
        signal = signal.where(regimes.reindex(idx) != CHAOS, 0.0)
        # --- direction imposée par le régime ---
        direction = routed.direction_mask.reindex(idx)
        signal = signal.where(~(direction == 1.0) | (signal >= 0), 0.0)
        signal = signal.where(~(direction == -1.0) | (signal <= 0), 0.0)

        # --- stop obligatoire et objectif, en ATR du timeframe d'exécution ---
        atr = ctx.col("atr", exec_tf)
        if atr.isna().all():
            atr = ctx.col("atr")
        close = df["close"]
        atr = atr.reindex(idx).ffill()
        stop_dist = (self.atr_stop_mult * atr / close).clip(self.min_stop_pct, self.max_stop_pct)
        tp_dist = (self.atr_tp_mult * atr / close).clip(self.min_stop_pct * 1.5, self.max_stop_pct * 2)

        stop = np.where(signal > 0, close * (1 - stop_dist), close * (1 + stop_dist))
        tp = np.where(signal > 0, close * (1 + tp_dist), close * (1 - tp_dist))

        dec["signal"] = signal
        dec["stop_price"] = np.where(signal != 0, stop, np.nan)
        dec["take_profit"] = np.where(signal != 0, tp, np.nan)
        dec["atr_pct"] = (atr / close).fillna(0.0)
        dec["regime"] = regimes.reindex(idx).fillna("")
        dec["families"] = routed.families_used.reindex(idx).fillna("")
        return dec

    # ------------------------------------------------------------- diagnostics
    def routing_report(self) -> pd.DataFrame:
        rows = []
        for symbol, shares in self.regime_shares.items():
            for regime, row in shares.iterrows():
                rows.append({"symbol": symbol, "regime": regime, "bars": row["bars"], "share": row["share"]})
        return pd.DataFrame(rows)
