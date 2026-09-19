"""Strategy base class: turn market data into entry signals with SL/TP levels."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import pandas as pd

from quantbt.data.loader import MarketData

#: Signals frame contract — indexed like the base timeframe, with columns:
#:   signal: -1 (short), 0 (flat/no entry), +1 (long)
#:   sl:     stop-loss price (NaN when signal == 0)
#:   tp:     take-profit price (NaN when signal == 0)
#: A signal on bar t is only ever executed at the OPEN of bar t+1 by the engine.
Signals = pd.DataFrame


class Strategy(ABC):
    """Base class. Subclasses implement ``generate_signals`` and declare params.

    ``params`` are plain keyword values (from YAML); ``default_param_grid`` is
    used by optimization / sensitivity scans when the config does not provide
    an explicit grid.
    """

    name: str = "base"

    def __init__(self, **params: Any) -> None:
        self.params: dict[str, Any] = {**self.default_params(), **params}

    @classmethod
    def default_params(cls) -> dict[str, Any]:
        return {}

    @classmethod
    def default_param_grid(cls) -> dict[str, list[Any]]:
        return {}

    def with_params(self, **overrides: Any) -> "Strategy":
        """New instance of the same strategy with some params replaced."""
        merged = {**self.params, **overrides}
        return type(self)(**merged)

    @abstractmethod
    def generate_signals(self, data: MarketData) -> Signals:
        """Compute signal/sl/tp for every bar. Must not look ahead: values on
        bar t may only use information available at the close of bar t."""
        raise NotImplementedError
