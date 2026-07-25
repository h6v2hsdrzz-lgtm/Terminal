# okx_algo — recherche, backtest et exécution long/short sur perpétuels OKX

Framework de recherche systématique pour une stratégie long/short sur
BTC-USDT-SWAP, ETH-USDT-SWAP et SOL-USDT-SWAP.

> **Principe non négociable.** Le backtest sert à *invalider* la stratégie, pas
> à la vendre. Aucun paramètre n'est ajusté pour atteindre un chiffre cible. Si
> l'objectif n'est pas atteignable, le livrable est ce constat, chiffré.

---

## Démarrage

```bash
python3 -m venv .venv
.venv/bin/pip install numpy pandas pyarrow scipy pyyaml requests matplotlib pytest

.venv/bin/python -m okx_algo.run --status     # état courant, sans rien exécuter
.venv/bin/python -m okx_algo.run --resume     # reprend exactement où on s'est arrêté
.venv/bin/python -m pytest okx_algo/tests -q  # tests unitaires
```

`--resume` est **idempotent** : une étape déjà terminée n'est jamais recalculée
et n'ajoute aucune ligne au registre d'essais.

---

## Architecture

```
okx_algo/
├── config/base.yaml     # zéro paramètre en dur ailleurs
├── core/                # config, persistance atomique, cache indexé par hash
├── data/                # clients OKX & Binance-vision, store Parquet, panel, qualité
├── features/            # calculs vectorisés, tous décalés d'une barre
├── strategies/          # les trois briques + stratégies triviales de contrôle
├── modulators/          # modulateur de funding (multiplicateur, pas une brique)
├── portfolio/           # risk parity à contribution égalisée, netting, vol targeting
├── leverage/            # calibration du levier — cœur du projet (§8)
├── risk/                # moteur de risque : application + vérification
├── execution/           # coûts, simulateur de remplissage maker-first
├── backtest/            # boucle event-driven, métriques, benchmarks, auto-tests
├── validation/          # walk-forward, purged k-fold, Monte Carlo, Deflated Sharpe
├── research/            # registre d'essais, hypothèses, orchestration
└── reports/             # rapport final
```

Sorties : `artifacts/` (rapports, CSV), `research/research_log.jsonl` (registre
append-only), `state/run_state.json` (état de reprise), `JOURNAL.md`.

---

## Les trois briques

Chaque brique est **indépendante**, testable seule, et produit une position
cible normalisée dans [-1, +1] par actif. Aucune ne connaît les autres.

| Brique | Mécanisme | Budget de risque | Horizon |
|---|---|---|---|
| 1 — momentum time-series | tanh(rendement / vol) sur 3 horizons, vol-targeté | 60-70 % | 1 à 5 jours |
| 2 — momentum cross-sectionnel | z-score en coupe, dollar-neutre | 20-30 % | quotidien |
| 3 — reversal post-cascade | 5 conditions de liquidation forcée | 10-20 % | minutes à heures |

La brique 3 est la seule brique court terme retenue parce que son edge est
**structurel** (liquidations forcées, carnet asséché), pas statistique.

**Aucune brique de carry de funding** : interdit par le mandat. Le Sharpe du
carry crypto s'est comprimé de ~6,5 (2020-2025) à ~4 (2024) puis en territoire
négatif (2025). Le funding sert uniquement de **modulateur défensif**.

---

## Réalisme d'exécution

- **Frais OKX réels** : maker 0,02 %, taker 0,05 %.
- **Remplissage maker modélisé** : un ordre limite passif n'est pas rempli à
  coup sûr. La probabilité dépend de la pénétration du prix dans la barre ;
  après timeout, bascule en taker et paiement du spread.
- **Slippage** : spread (élargi en vol haute) + fraction d'ATR + impact de
  taille rapporté au volume de la barre.
- **Funding réel** toutes les 8 h sur le notionnel.
- **Liquidation** en marge croisée sur le **mark price**, avec descente en 1 min
  pour dater l'événement. Chaque liquidation est comptée et rapportée.
- **Résolution intrabar** : descente en 1 min dès qu'un stop peut être touché ;
  à défaut, hypothèse pessimiste.
- **Exécution décalée** : signal à la clôture de la barre N → exécution en N+1,
  les features étant elles-mêmes décalées d'une barre.

---

## Moteur de risque — deux couches distinctes

C'est un choix de conception important, et il a déjà payé.

1. **Application** — `approve_order` refuse ou réduit avant exécution ;
   `update` déclenche les mises à plat et les halts.
2. **Vérification** — `assert_invariants` relit l'état réel après coup et **lève
   une exception** si une borne est franchie.

Si la seconde couche se déclenche, c'est que la première a un bug : le backtest
s'arrête plutôt que de produire un résultat faussé. Elle a effectivement
détecté, pendant le développement, un dépassement du plafond de positions dû à
des ordres non comptabilisés.

| Contrainte | Défaut | Comportement |
|---|---|---|
| levier effectif max | 10 | refus d'ordre |
| positions simultanées | 2 (+1 cascade) | refus d'ouverture |
| drawdown quotidien | −5 % | flat + halt jusqu'à 00:00 UTC |
| drawdown hebdomadaire | −12 % | flat + halt jusqu'à lundi |
| drawdown mensuel | −25 % | flat + halt jusqu'au 1er |
| kill switch global | −40 % du HWM | arrêt définitif |
| stop-loss | obligatoire | aucune position sans SL enregistré |

---

## Protocole de recherche (le plus important)

Chaque configuration testée est un tirage. En testant assez de configurations,
on trouve toujours quelque chose qui dépasse la cible — **y compris sur des
données purement aléatoires**. C'est une propriété de la recherche répétée, pas
un défaut d'implémentation.

Le dispositif qui rend l'itération honnête :

1. **Hypothèses pré-enregistrées** dans `research/HYPOTHESES.md`, chacune avec
   sa justification économique **écrite à l'avance**. Une hypothèse sans
   rationale n'est pas testée.
2. **Registre automatique append-only** (`research/research_log.jsonl`) : une
   ligne par configuration, écrite par le moteur, jamais à la main, jamais
   supprimée. Un essai fait est un essai compté.
3. **Deflated Sharpe Ratio** pénalisé par le nombre d'essais réellement
   consommés. Plus on cherche, plus la barre monte — une recherche en force
   brute se sabote elle-même.
4. **Budget de 200 configurations**, compteur global.
5. **Out-of-sample ouvert une seule fois**, à la toute fin. `run_oos_validation`
   refuse de s'exécuter deux fois et scelle l'événement dans l'état.

---

## Reprise après interruption

Le projet est conçu pour être interrompu à n'importe quel instant.

- Écriture **atomique** systématique (fichier temporaire puis renommage).
- État mis à jour après **chaque** étape terminée, pas en fin de phase.
- Tout calcul long est **checkpointé** et indexé par un hash de ses entrées :
  relancer avec les mêmes entrées lit le cache.
- `JOURNAL.md` documente les décisions et la prochaine action.

Ce n'est pas théorique : le téléchargement a été tué deux fois en cours de
session et a repris sans perte ni doublon.

---

## Ce que le framework ne prétend pas faire

- Le funding et l'open interest historiques profonds **ne viennent pas d'OKX**
  (l'API publique ne les retient pas). Ils proviennent des dumps Binance USD-M ;
  l'écart est **mesuré** et rapporté, pas supposé.
- Le taux de remplissage maker est modélisé à partir de la barre, **pas d'un
  carnet d'ordres niveau 2**. C'est la principale incertitude sur les coûts.
- Aucun open interest avant 2021 : la brique 3 ne peut pas se déclencher en
  2020, et c'est documenté plutôt que contourné.
