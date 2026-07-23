"""Le plafond dur de 2 %/trade : la propriété de sécurité n° 1 du moteur live."""

from __future__ import annotations

import pytest

from goldsilver.live.risk import (
    HARD_MAX_RISK_PCT,
    RiskCapError,
    assert_order_within_cap,
    validate_configured_risk,
)


def test_hard_cap_is_two_percent() -> None:
    assert HARD_MAX_RISK_PCT == 0.02


def test_config_above_cap_refused() -> None:
    with pytest.raises(RiskCapError, match="plafond dur"):
        validate_configured_risk(0.021, 0.05)
    with pytest.raises(RiskCapError):
        validate_configured_risk(0.10, 0.20)


def test_config_at_or_below_cap_accepted() -> None:
    validate_configured_risk(0.02, 0.04)
    validate_configured_risk(0.005, 0.01)


def test_invalid_configs_refused() -> None:
    with pytest.raises(RiskCapError):
        validate_configured_risk(0.0, 0.02)
    with pytest.raises(RiskCapError):
        validate_configured_risk(0.01, 0.005)   # budget global < risque unitaire


def test_order_level_double_check() -> None:
    assert_order_within_cap(risk_amount=200.0, equity=10_000.0)   # exactement 2 %
    with pytest.raises(RiskCapError, match="Ordre refusé"):
        assert_order_within_cap(risk_amount=201.0, equity=10_000.0)
    with pytest.raises(RiskCapError):
        assert_order_within_cap(risk_amount=50.0, equity=0.0)
