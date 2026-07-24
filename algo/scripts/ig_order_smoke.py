"""Test d'ordres RÉELS sur le compte IG DÉMO (argent fictif, cycle d'ordre réel).

Place quelques petits ordres au marché (taille minimale) avec SL/TP posés chez
IG via l'adaptateur du bot (le MÊME code que le moteur utilise), vérifie qu'ils
apparaissent avec les bons SL/TP, puis REFERME tout. But : prouver que le
chemin d'ordre (place -> confirm -> position -> close) fonctionne bout en bout.

Sécurité : ne tourne QUE sur IG_ENV=demo. Ferme toujours ce qu'il ouvre
(try/finally). N'affiche jamais les identifiants.

Usage : set -a; source .env; set +a; python3 scripts/ig_order_smoke.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from goldsilver.live.broker.ig import IgBroker  # noqa: E402
from goldsilver.live.config import load_live_config  # noqa: E402


def main() -> int:
    if os.environ.get("IG_ENV", "demo").lower() != "demo":
        print("REFUS : ce test ne tourne que sur IG_ENV=demo.")
        return 1
    cfg = load_live_config("config/live.yaml")
    b = IgBroker(expected_env="demo", contracts=cfg.broker.ig_contracts)

    acct0 = b.get_account()
    print(f"Compte démo : {acct0.equity:.2f} {acct0.currency} | positions ouvertes : "
          f"{len(b.get_open_positions())}\n")

    # (actif, epic, unités en oz correspondant à ~0.1 contrat = minimum)
    #   or   : oz_per_contract=1   -> 0.1 oz  = 0.1 contrat
    #   argt : oz_per_contract=500 -> 50 oz   = 0.1 contrat
    orders = [
        ("XAUUSD", cfg.broker.instruments["XAUUSD"], 0.1),
        ("XAGUSD", cfg.broker.instruments["XAGUSD"], 50.0),
    ]
    opened: list[str] = []
    try:
        for asset, epic, units in orders:
            q = b.get_quote(epic)
            nd = cfg.broker.ig_contracts[epic].level_decimals
            # long : SL 1.5 % sous l'ask, TP 4.5 % au-dessus (R:R 3), arrondi
            sl = round(q.ask * 0.985, nd)
            tp = round(q.ask * 1.045, nd)
            print(f"→ ORDRE {asset} [{epic}] : ACHAT {units:g} oz @~{q.ask} "
                  f"(SL {sl} / TP {tp})")
            res = b.place_market_order(epic, units, sl, tp, client_tag=f"smoke-{asset}")
            if not res.accepted:
                print(f"   ❌ refusé : {res.reason}")
                continue
            opened.append(epic)
            print(f"   ✅ exécuté @ {res.fill_price} | dealId {res.trade_id} "
                  f"({res.units:g} oz)")
            time.sleep(1.0)

        print("\n=== Positions ouvertes après les ordres ===")
        for p in b.get_open_positions():
            print(f"   {p.instrument} : {p.units:+g} oz @ {p.avg_price} | "
                  f"SL {p.sl} | TP {p.tp} | PnL latent {p.unrealized_pnl:+.2f}")
    finally:
        print("\n=== Fermeture de toutes les positions du test ===")
        for epic in opened:
            try:
                r = b.close_position(epic)
                print(f"   {epic} : fermé ({r.reason}) @ {r.fill_price}")
            except Exception as e:  # noqa: BLE001
                print(f"   {epic} : ⚠️ échec fermeture — À FERMER MANUELLEMENT : {e}")
        time.sleep(1.0)

    remaining = b.get_open_positions()
    acct1 = b.get_account()
    print(f"\nPositions restantes : {len(remaining)} (doit être 0)")
    print(f"Compte démo après test : {acct1.equity:.2f} {acct1.currency} "
          f"(variation {acct1.equity - acct0.equity:+.2f} — spread/frais du round-trip)")
    return 0 if not remaining else 2


if __name__ == "__main__":
    raise SystemExit(main())
