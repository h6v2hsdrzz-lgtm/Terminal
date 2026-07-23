"""Interface BrokerAdapter : tout broker (OANDA, IG, paper) l'implémente.

Le moteur ne parle QU'À cette interface. Conventions :
- ``instrument`` : identifiant broker (ex. OANDA ``XAU_USD``) — le mapping
  actif interne -> instrument vit dans la config.
- ``units`` : positif = long, négatif = short, en unités de l'instrument
  (1 unité XAU_USD = 1 once).
- Les SL/TP sont posés CHEZ le broker à l'entrée (``place_market_order``),
  jamais gérés seulement en mémoire : un crash du bot laisse la position
  protégée côté serveur.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import pandas as pd


class BrokerError(RuntimeError):
    """Erreur broker après épuisement des retries — le moteur NE TRADE PAS."""


@dataclass(frozen=True)
class Quote:
    instrument: str
    bid: float
    ask: float
    time: pd.Timestamp
    tradeable: bool


@dataclass(frozen=True)
class AccountState:
    equity: float            # NAV : balance + PnL latent
    balance: float
    margin_available: float
    currency: str


@dataclass(frozen=True)
class BrokerPosition:
    instrument: str
    units: float             # signé (+ long / - short)
    avg_price: float
    trade_id: str            # identifiant broker du trade (réconciliation)
    sl: float | None
    tp: float | None
    unrealized_pnl: float


@dataclass(frozen=True)
class OrderResult:
    accepted: bool
    trade_id: str | None
    fill_price: float | None
    units: float
    reason: str              # "filled" | motif de rejet


@dataclass(frozen=True)
class ClosedTrade:
    trade_id: str
    instrument: str
    units: float
    realized_pnl: float
    close_price: float | None
    close_time: pd.Timestamp | None


class BrokerAdapter(ABC):
    """Contrat minimal dont le moteur a besoin. Implémentations : oanda, paper."""

    name: str = "base"

    @abstractmethod
    def get_candles(self, instrument: str, hours: int) -> pd.DataFrame:
        """Bougies H1 TERMINÉES, index UTC, colonnes open/high/low/close/volume/spread.

        Prix côté bid + colonne ``spread`` (ask-bid) : même convention que le
        backtest, pour que la stratégie voie des données identiques.
        """

    @abstractmethod
    def get_quote(self, instrument: str) -> Quote:
        """Prix courant bid/ask + tradeable (marché ouvert)."""

    @abstractmethod
    def get_account(self) -> AccountState: ...

    @abstractmethod
    def get_open_positions(self) -> list[BrokerPosition]: ...

    @abstractmethod
    def place_market_order(
        self,
        instrument: str,
        units: float,
        sl_price: float,
        tp_price: float,
        client_tag: str,
    ) -> OrderResult:
        """Ordre au marché avec SL/TP attachés côté broker. units signé."""

    @abstractmethod
    def close_position(self, instrument: str) -> OrderResult:
        """Ferme la position au marché (flatten)."""

    @abstractmethod
    def get_closed_trades_since(self, since_trade_id: str | None) -> list[ClosedTrade]:
        """Trades clôturés depuis un id (réconciliation post-redémarrage)."""
