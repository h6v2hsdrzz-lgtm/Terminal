"""Chargement de la configuration YAML.

Regle du projet : aucun parametre en dur dans le code. Tout passe par ici.
"""
from __future__ import annotations

import copy
import datetime as dt
import os
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = REPO_ROOT / "okx_algo" / "config" / "base.yaml"


class Config:
    """Acces par chemin pointe, avec resolution des chemins projet."""

    def __init__(self, raw: dict[str, Any], path: Path | None = None):
        self._raw = raw
        self.path = path

    # ------------------------------------------------------------------
    @classmethod
    def load(cls, path: str | Path | None = None) -> "Config":
        p = Path(path) if path else DEFAULT_CONFIG
        with open(p) as fh:
            raw = yaml.safe_load(fh)
        return cls(raw, p)

    def copy(self) -> "Config":
        return Config(copy.deepcopy(self._raw), self.path)

    # ------------------------------------------------------------------
    def get(self, dotted: str, default: Any = "__RAISE__") -> Any:
        node: Any = self._raw
        for part in dotted.split("."):
            if not isinstance(node, dict) or part not in node:
                if default == "__RAISE__":
                    raise KeyError(f"cle de config absente: {dotted}")
                return default
            node = node[part]
        return node

    def set(self, dotted: str, value: Any) -> None:
        parts = dotted.split(".")
        node = self._raw
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value

    def __getitem__(self, key: str) -> Any:
        return self.get(key)

    @property
    def raw(self) -> dict[str, Any]:
        return self._raw

    # ------------------------------------------------------------------
    # Chemins projet
    def root(self, which: str) -> Path:
        p = REPO_ROOT / self.get(f"project.{which}_root")
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def data_root(self) -> Path:
        return self.root("data")

    @property
    def state_root(self) -> Path:
        return self.root("state")

    @property
    def research_root(self) -> Path:
        return self.root("research")

    @property
    def artifacts_root(self) -> Path:
        return self.root("artifacts")

    @property
    def logs_root(self) -> Path:
        return self.root("logs")

    # ------------------------------------------------------------------
    # Bornes temporelles, toujours UTC
    def data_start(self) -> dt.datetime:
        return _parse_utc(self.get("data.start"))

    def data_end(self) -> dt.datetime:
        end = self.get("data.end", None)
        return _parse_utc(end) if end else _now_utc()

    def is_bounds(self) -> tuple[dt.datetime, dt.datetime]:
        return _parse_utc(self.get("split.in_sample_start")), _parse_utc(
            self.get("split.in_sample_end")
        ).replace(hour=23, minute=59, second=59)

    def oos_bounds(self) -> tuple[dt.datetime, dt.datetime]:
        end = self.get("split.out_of_sample_end", None)
        return (
            _parse_utc(self.get("split.out_of_sample_start")),
            _parse_utc(end) if end else _now_utc(),
        )


def _parse_utc(value: Any) -> dt.datetime:
    if isinstance(value, dt.datetime):
        return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value
    if isinstance(value, dt.date):
        return dt.datetime(value.year, value.month, value.day, tzinfo=dt.timezone.utc)
    return dt.datetime.fromisoformat(str(value)).replace(tzinfo=dt.timezone.utc)


def _now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def load_config(path: str | Path | None = None) -> Config:
    return Config.load(path or os.environ.get("OKX_ALGO_CONFIG"))
