"""Strategies triviales : reference de validation du moteur (§14, §11.8).

Elles ne contiennent aucun signal. Elles servent a repondre a deux questions
avant d'ecrire la moindre strategie reelle :

  * le moteur reproduit-il un buy & hold connu analytiquement ?
  * une strategie a entrees aleatoires perd-elle bien de l'argent ?

Si la reponse a la seconde est non, le moteur est faux et tout ce qui suit est
sans valeur.
"""
from __future__ import annotations

import numpy as np

from ..backtest.engine import Targets
from ..data.panel import Panel


def _blank(panel: Panel) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    shape = (panel.n, len(panel.symbols))
    return (np.zeros(shape), np.full(shape, np.nan),
            np.full(shape, -1, dtype=np.int64), np.zeros(shape, dtype=bool))


def buy_and_hold(panel: Panel, symbol: str | None = None, weight: float = 1.0) -> Targets:
    w, stops, exits, casc = _blank(panel)
    valid = panel.valid_matrix()
    if symbol is None:
        n_valid = np.maximum(valid.sum(axis=1, keepdims=True), 1)
        w = np.where(valid, weight / n_valid, 0.0)
    else:
        j = panel.symbols.index(symbol)
        w[:, j] = np.where(valid[:, j], weight, 0.0)
    return Targets(weights=w, stops=stops, exit_by=exits, cascade=casc)


def equal_weight_basket(panel: Panel) -> Targets:
    return buy_and_hold(panel, symbol=None, weight=1.0)


def random_entries(panel: Panel, seed: int, avg_holding_bars: int = 48,
                   exposure: float = 0.5) -> Targets:
    """Controle negatif : memes tailles, meme moteur, direction aleatoire.

    Le tirage est fait une fois par bloc de detention, pas a chaque barre :
    sinon la position moyenne serait nulle et la strategie ne paierait aucun
    cout, ce qui viderait le test de son sens.
    """
    rng = np.random.default_rng(seed)
    n, k = panel.n, len(panel.symbols)
    w, stops, exits, casc = _blank(panel)
    valid = panel.valid_matrix()
    for j in range(k):
        i = 0
        while i < n:
            hold = max(1, int(rng.exponential(avg_holding_bars)))
            side = rng.choice([-1.0, 0.0, 1.0], p=[0.4, 0.2, 0.4])
            w[i:i + hold, j] = side * exposure
            i += hold
    return Targets(weights=np.where(valid, w, 0.0), stops=stops, exit_by=exits, cascade=casc)


def constant_leverage(panel: Panel, symbol: str, leverage: float) -> Targets:
    """Benchmark BTC x2 : exposition constante, rebalancee par le deadband."""
    return buy_and_hold(panel, symbol=symbol, weight=leverage)
