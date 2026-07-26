"""Chargement de la configuration.

Un seul point d'entrée : ``load_config()``. Aucun paramètre numérique ne doit
apparaître en dur dans le reste du code — s'il en manque un, on l'ajoute au YAML.
"""

from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any, Iterable, Mapping

import yaml

CONFIG_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = CONFIG_DIR / "default.yaml"
PACKAGE_ROOT = CONFIG_DIR.parent
PROJECT_ROOT = PACKAGE_ROOT.parent


class Config(dict):
    """dict avec accès pointé en lecture : ``cfg.get_path("risk.leverage_max")``."""

    def get_path(self, path: str, default: Any = "__raise__") -> Any:
        node: Any = self
        for part in path.split("."):
            if isinstance(node, Mapping) and part in node:
                node = node[part]
            else:
                if default == "__raise__":
                    raise KeyError(f"Paramètre de configuration absent : {path!r}")
                return default
        return node

    def sub(self, path: str) -> "Config":
        node = self.get_path(path)
        if not isinstance(node, Mapping):
            raise TypeError(f"{path!r} n'est pas une section de configuration")
        return Config(copy.deepcopy(dict(node)))

    def with_overrides(self, overrides: Mapping[str, Any]) -> "Config":
        """Renvoie une copie avec des surcharges ``{"risk.risk_per_trade": 0.01}``."""
        new = Config(copy.deepcopy(dict(self)))
        for path, value in overrides.items():
            node: Any = new
            parts = path.split(".")
            for part in parts[:-1]:
                node = node.setdefault(part, {})
            node[parts[-1]] = value
        return new


def _deep_merge(base: dict, override: Mapping) -> dict:
    out = copy.deepcopy(base)
    for key, value in override.items():
        if key in out and isinstance(out[key], dict) and isinstance(value, Mapping):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def load_config(
    paths: str | os.PathLike | Iterable[str | os.PathLike] | None = None,
    overrides: Mapping[str, Any] | None = None,
) -> Config:
    """Charge ``default.yaml`` puis fusionne les fichiers/surcharges fournis."""
    with open(DEFAULT_CONFIG_PATH, "r", encoding="utf-8") as fh:
        merged: dict = yaml.safe_load(fh) or {}

    if paths is not None:
        if isinstance(paths, (str, os.PathLike)):
            paths = [paths]
        for path in paths:
            with open(path, "r", encoding="utf-8") as fh:
                merged = _deep_merge(merged, yaml.safe_load(fh) or {})

    cfg = Config(merged)
    if overrides:
        cfg = cfg.with_overrides(overrides)
    return cfg


def resolve_path(cfg: Config, path_value: str | os.PathLike) -> Path:
    """Résout un chemin de la config relativement à la racine du projet."""
    p = Path(path_value)
    if p.is_absolute():
        return p
    return PROJECT_ROOT / p


__all__ = ["Config", "load_config", "resolve_path", "PROJECT_ROOT", "PACKAGE_ROOT"]
