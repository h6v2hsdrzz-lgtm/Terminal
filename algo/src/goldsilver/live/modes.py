"""Modes de trading et verrouillage physique du mode LIVE.

PAPER : ordres simulés localement, données de marché réelles. Aucun ordre
        ne part vers un broker. Point de départ OBLIGATOIRE.
DEMO  : ordres réels sur compte de démonstration (argent fictif chez le
        broker, cycle de vie d'ordre réel).
LIVE  : argent réel. Verrouillé par TROIS conditions indépendantes :
        1. ``mode: live`` écrit explicitement dans la config ;
        2. la variable d'environnement ``GOLDSILVER_LIVE_ACK`` contenant
           exactement la phrase ``JE-COMPRENDS-ARGENT-REEL`` ;
        3. le flag CLI ``--enable-live`` au lancement.
        Il manque une seule condition -> le process refuse de démarrer.
"""

from __future__ import annotations

import os
from enum import Enum

LIVE_ACK_ENV = "GOLDSILVER_LIVE_ACK"
LIVE_ACK_PHRASE = "JE-COMPRENDS-ARGENT-REEL"


class TradingMode(str, Enum):
    PAPER = "paper"
    DEMO = "demo"
    LIVE = "live"


class LiveLockError(RuntimeError):
    """Levée quand le mode LIVE est demandé sans les trois verrous."""


def check_live_gate(mode: TradingMode, cli_enable_live: bool) -> None:
    """Refuse le démarrage si LIVE est demandé sans les trois verrous.

    Appelée au démarrage AVANT toute connexion broker. Ne retourne rien :
    lève ``LiveLockError`` avec un message actionnable sinon.
    """
    if mode is not TradingMode.LIVE:
        if cli_enable_live:
            raise LiveLockError(
                "--enable-live est passé mais la config est en mode "
                f"{mode.value!r} : incohérence, on refuse par sécurité."
            )
        return
    missing: list[str] = []
    if not cli_enable_live:
        missing.append("le flag CLI --enable-live")
    if os.environ.get(LIVE_ACK_ENV) != LIVE_ACK_PHRASE:
        missing.append(
            f"la variable d'environnement {LIVE_ACK_ENV}={LIVE_ACK_PHRASE!r}"
        )
    if missing:
        raise LiveLockError(
            "MODE LIVE REFUSÉ — il manque : " + " ET ".join(missing)
            + ". Le mode live engage de l'argent réel ; ces verrous sont "
            "volontaires et ne doivent pas être contournés dans le code."
        )
