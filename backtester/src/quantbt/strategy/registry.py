"""Name → Strategy class registry so YAML configs can pick strategies."""

from __future__ import annotations

from typing import Any, Callable

from quantbt.strategy.base import Strategy

_REGISTRY: dict[str, type[Strategy]] = {}


def register(cls: type[Strategy]) -> type[Strategy]:
    _REGISTRY[cls.name] = cls
    return cls


def get_strategy(name: str, **params: Any) -> Strategy:
    # Import examples lazily so registration happens on first use.
    import quantbt.strategy.examples  # noqa: F401

    try:
        cls = _REGISTRY[name]
    except KeyError as exc:
        raise KeyError(f"unknown strategy '{name}'; known: {sorted(_REGISTRY)}") from exc
    return cls(**params)
