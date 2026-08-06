"""Dashboard : accès temps réel aux données de l'algo, du marché et du risque.

Trois sources, fusionnées par ``data.py`` :

1. **Cache backtest** (``dashboard_data/``, versionné) — l'historique complet
   de la stratégie validée : chaque trade avec entrée/sortie, l'equity, les
   métriques. Versionné car ``data/raw/`` et ``reports/`` sont gitignorés :
   sans ce cache, le dashboard serait vide sur un clone neuf.
2. **Journal live** (``live_state/journal.jsonl``) — ce que le bot a
   réellement fait en paper/demo/live. Source de vérité de l'audit.
3. **Broker IG** (optionnel) — cotations et bougies fraîches. Absent =
   dashboard toujours utilisable, en mode hors-ligne sur le cache.

Le serveur n'utilise que la bibliothèque standard : aucune dépendance web à
installer, il tourne partout où le bot tourne.
"""

from __future__ import annotations

__all__ = ["build_cache", "data", "server"]
