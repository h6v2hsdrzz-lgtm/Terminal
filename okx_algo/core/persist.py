"""Persistance : ecriture atomique, etat de run, cache indexe par hash (§17).

Invariants :
  * toute ecriture d'etat est atomique (tmp + os.replace) — une coupure ne
    laisse jamais un fichier a moitie ecrit ;
  * un calcul long relance avec les memes entrees LIT le cache, ne recalcule pas ;
  * le registre d'essais est append-only : aucune ligne n'est jamais reecrite.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import pickle
import tempfile
from pathlib import Path
from typing import Any, Callable


# ----------------------------------------------------------------------
# Ecriture atomique
# ----------------------------------------------------------------------
def atomic_write_text(path: str | Path, text: str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def atomic_write_json(path: str | Path, obj: Any) -> None:
    atomic_write_text(path, json.dumps(obj, indent=2, default=str))


def atomic_write_bytes(path: str | Path, data: bytes) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def append_jsonl(path: str | Path, obj: dict) -> None:
    """Ajout append-only, flush + fsync : une ligne ecrite est une ligne acquise."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as fh:
        fh.write(json.dumps(obj, default=str) + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def read_jsonl(path: str | Path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # ligne tronquee par une coupure : ignoree en lecture
    return out


# ----------------------------------------------------------------------
# Hash de parametres
# ----------------------------------------------------------------------
def stable_hash(obj: Any, length: int = 16) -> str:
    """Hash stable et deterministe d'une structure JSON-serialisable."""
    payload = json.dumps(_normalise(obj), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:length]


def _normalise(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _normalise(v) for k, v in sorted(obj.items(), key=lambda kv: str(kv[0]))}
    if isinstance(obj, (list, tuple)):
        return [_normalise(v) for v in obj]
    if isinstance(obj, (dt.datetime, dt.date)):
        return obj.isoformat()
    if isinstance(obj, float):
        return round(obj, 12)
    return obj


# ----------------------------------------------------------------------
# Cache disque indexe par hash des entrees (§17.2)
# ----------------------------------------------------------------------
class ComputeCache:
    def __init__(self, root: str | Path, namespace: str = "generic"):
        self.dir = Path(root) / "cache" / namespace
        self.dir.mkdir(parents=True, exist_ok=True)

    def key(self, params: Any) -> str:
        return stable_hash(params)

    def path(self, params: Any, ext: str = "pkl") -> Path:
        return self.dir / f"{self.key(params)}.{ext}"

    def has(self, params: Any, ext: str = "pkl") -> bool:
        return self.path(params, ext).exists()

    def get_or_compute(self, params: Any, fn: Callable[[], Any], ext: str = "pkl") -> Any:
        p = self.path(params, ext)
        if p.exists():
            try:
                with open(p, "rb") as fh:
                    return pickle.load(fh)
            except (EOFError, pickle.UnpicklingError):
                p.unlink()  # cache corrompu par une coupure : on recalcule
        value = fn()
        atomic_write_bytes(p, pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL))
        # trace lisible de ce qui a produit cette entree
        atomic_write_json(p.with_suffix(".meta.json"),
                          {"params": _normalise(params), "created": _now_iso()})
        return value


# ----------------------------------------------------------------------
# Etat de run (§17.1)
# ----------------------------------------------------------------------
class RunState:
    """Etat persistant du projet. Mis a jour apres CHAQUE etape terminee."""

    DEFAULT = {
        "phase": "init",
        "completed_steps": [],
        "current_hypothesis": None,
        "config_index": 0,
        "seed": None,
        "downloaded": {},
        "notes": {},
        "updated_at": None,
        "oos_opened": False,
        "oos_opened_at": None,
    }

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.data = dict(self.DEFAULT)
        if self.path.exists():
            try:
                self.data.update(json.loads(self.path.read_text()))
            except json.JSONDecodeError:
                pass  # etat corrompu : on repart du defaut plutot que de crasher

    def save(self) -> None:
        """Ecrit l'etat en FUSIONNANT avec ce qui est deja sur disque.

        Plusieurs processus travaillent en parallele (un telechargement de fond
        et les etapes au premier plan). Chacun detient sa propre instance : une
        ecriture qui remplacerait le fichier ecraserait silencieusement les
        etapes terminees par l'autre processus — c'est exactement ce qui est
        arrive aux drapeaux `data_quality` et `engine_selftest`. La fusion rend
        l'ecriture concurrente sure : les etapes terminees s'unissent, les
        autres champs suivent la derniere ecriture.
        """
        self.data["updated_at"] = _now_iso()
        merged = dict(self.data)
        if self.path.exists():
            try:
                on_disk = json.loads(self.path.read_text())
            except (json.JSONDecodeError, OSError):
                on_disk = {}
            steps = list(on_disk.get("completed_steps", []))
            for s in merged.get("completed_steps", []):
                if s not in steps:
                    steps.append(s)
            merged["completed_steps"] = steps
            notes = dict(on_disk.get("notes", {}))
            notes.update(merged.get("notes", {}))
            merged["notes"] = notes
            merged["downloaded"] = {**on_disk.get("downloaded", {}),
                                    **merged.get("downloaded", {})}
            # l'ouverture de l'out-of-sample est un fait irreversible : une fois
            # scellee par un processus, aucun autre ne peut la desceller
            if on_disk.get("oos_opened"):
                merged["oos_opened"] = True
                merged["oos_opened_at"] = (merged.get("oos_opened_at")
                                           or on_disk.get("oos_opened_at"))
        self.data = merged
        atomic_write_json(self.path, merged)

    # -- etapes ---------------------------------------------------------
    def is_done(self, step: str) -> bool:
        return step in self.data["completed_steps"]

    def mark_done(self, step: str, **notes: Any) -> None:
        if step not in self.data["completed_steps"]:
            self.data["completed_steps"].append(step)
        if notes:
            self.data["notes"][step] = notes
        self.save()

    def set(self, key: str, value: Any) -> None:
        self.data[key] = value
        self.save()

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()
