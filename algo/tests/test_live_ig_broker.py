"""Adaptateur IG : conversions et parsing propres à IG, sans réseau.

On teste les fonctions PURES (onces<->contrats, parsing PnL, marqueur de
réconciliation) et le rejet propre quand une spec de contrat manque —
aucun appel réseau, aucune dépendance aux variables d'environnement.
"""

from __future__ import annotations

import math

import pytest

from goldsilver.live.config import IgContractSpec
from goldsilver.live.broker.base import BrokerError
from goldsilver.live.broker.ig import IgBroker, oz_to_contracts, parse_pnl

GOLD = IgContractSpec(oz_per_contract=100.0, min_contracts=0.1,
                      contract_step=0.1, level_decimals=2)
SILVER = IgContractSpec(oz_per_contract=5000.0, min_contracts=0.1,
                        contract_step=0.1, level_decimals=3)


def test_oz_to_contracts_basic() -> None:
    # 250 oz d'or à 100 oz/contrat = 2.5 contrats
    assert math.isclose(oz_to_contracts(250.0, GOLD), 2.5)
    # signe ignoré (valeur absolue) : la direction est gérée à part
    assert math.isclose(oz_to_contracts(-250.0, GOLD), 2.5)


def test_oz_to_contracts_rounds_down_to_step() -> None:
    # 279 oz -> 2.79 contrats -> pas de 0.1 -> 2.7 (jamais 2.8)
    assert math.isclose(oz_to_contracts(279.0, GOLD), 2.7)


def test_oz_to_contracts_below_min_returns_zero() -> None:
    # 5 oz d'or = 0.05 contrat < min 0.1 -> refus (0.0), pas d'arrondi vers le haut
    assert oz_to_contracts(5.0, GOLD) == 0.0
    # 400 oz d'argent = 0.08 contrat < 0.1 -> refus
    assert oz_to_contracts(400.0, SILVER) == 0.0
    # 500 oz d'argent = exactement 0.1 contrat -> accepté
    assert math.isclose(oz_to_contracts(500.0, SILVER), 0.1)


def test_parse_pnl_currency_prefix() -> None:
    # IG préfixe le PnL de la devise
    assert math.isclose(parse_pnl("USD-12.30"), -12.30)
    assert math.isclose(parse_pnl("USD45.60"), 45.60)
    assert math.isclose(parse_pnl("E1,234.50"), 1234.50)
    assert parse_pnl(None) == 0.0
    assert math.isclose(parse_pnl(-7.5), -7.5)


def test_place_order_below_min_rejected_without_network() -> None:
    # Un IgBroker peut être instancié en injectant les specs sans env vars
    # si l'on ne déclenche pas la connexion. Ici on appelle directement la
    # conversion via la spec : une taille sous le minimum ne construit AUCUN
    # ordre (défense : jamais d'arrondi vers le haut).
    assert oz_to_contracts(9.0, GOLD) == 0.0


def test_missing_contract_spec_raises(monkeypatch) -> None:
    monkeypatch.setenv("IG_API_KEY", "k")
    monkeypatch.setenv("IG_IDENTIFIER", "id")
    monkeypatch.setenv("IG_PASSWORD", "pw")
    monkeypatch.setenv("IG_ENV", "demo")
    broker = IgBroker(expected_env="demo", contracts={})  # aucune spec
    with pytest.raises(BrokerError, match="spécification de contrat"):
        broker._spec("CS.D.CFDGOLD.CFDGC.IP")


def test_env_mismatch_refused(monkeypatch) -> None:
    monkeypatch.setenv("IG_API_KEY", "k")
    monkeypatch.setenv("IG_IDENTIFIER", "id")
    monkeypatch.setenv("IG_PASSWORD", "pw")
    monkeypatch.setenv("IG_ENV", "live")
    # le moteur attend demo mais l'env dit live -> refus de sécurité
    with pytest.raises(BrokerError, match="Incohérence d'environnement"):
        IgBroker(expected_env="demo")


def test_missing_credentials_refused(monkeypatch) -> None:
    for var in ("IG_API_KEY", "IG_IDENTIFIER", "IG_PASSWORD"):
        monkeypatch.delenv(var, raising=False)
    with pytest.raises(BrokerError, match="variables d'environnement"):
        IgBroker(expected_env="demo")
