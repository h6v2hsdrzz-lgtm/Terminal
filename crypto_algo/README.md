# crypto_algo — recherche et backtest, perpétuels crypto en levier x10

> **Le backtest est un outil d'audit, pas un outil de persuasion.** Sa fonction
> est de pouvoir *invalider* la stratégie. Un résultat négatif correctement
> mesuré vaut mieux qu'un résultat positif obtenu par surajustement.

Framework event-driven en Python pour la recherche, le backtest et l'audit
d'une stratégie directionnelle sur perpétuels USDT-margined (BTC, ETH, SOL).

---

## Installation

```bash
pip install -r requirements.txt
```

Dépendances : numpy, pandas, pyarrow, PyYAML, scipy, matplotlib, ccxt, pytest,
tabulate.

## Utilisation

```bash
# 1. données (incrémental, reprise automatique, comblement amont et aval)
python scripts/fetch_history.py --symbol "BTC/USDT:USDT"
python scripts/fetch_history.py --symbol "ETH/USDT:USDT"
python scripts/fetch_history.py --symbol "SOL/USDT:USDT"

# 2. contrôle qualité seul
python scripts/run_research.py --phase quality

# 3. in-sample + protocole de validation complet -> rapport HTML
python scripts/run_research.py --phase research

# 4. ouverture de l'out-of-sample — une seule fois, à la fin
python scripts/run_research.py --phase oos --unlock-oos "audit terminé le ..."

# 5. paper trading (60 jours minimum avant tout capital réel)
python scripts/paper_trade.py --iterations 1     # une passe, pour cron
python scripts/paper_trade.py --report           # comparaison live / backtest

# diagnostics complémentaires
python scripts/run_inversion_check.py     # erreur de signe ou absence d'edge ?
python scripts/run_intrabar_study.py      # biais de résolution 1m vs 5m vs pessimiste

# tests
python -m pytest crypto_algo/tests -q
```

Sorties : `reports_out/rapport_audit.html` (autoportant), `reports_out/tables/*.csv`,
`reports_out/figures/*.png`, `reports_out/summary.json`, `reports_out/trials.json`.

---

## Architecture

```
crypto_algo/
├── config/          YAML : tous les paramètres, aucun hardcode
├── data/            download ccxt, cache Parquet, qualité, funding reconstruit
├── features/        indicateurs causaux + alignement multi-TF sans lookahead
├── signals/         7 familles indépendantes, score normalisé [-1, +1]
├── regime/          classifieur 4 états + routage strict
├── risk/            moteur de risque — invariants vérifiés à chaque tick
├── execution/       fills, coûts, slippage, funding, liquidation, intrabar
├── backtest/        boucle event-driven + comptabilité portefeuille
├── strategies/      triviales (contrôles) + stratégie assemblée
├── validation/      walk-forward, k-fold purgé, Monte Carlo, DSR, robustesse
├── reports/         métriques, graphiques, rapport HTML
├── live/            paper trading, comparaison live vs backtest
└── tests/           143 tests — priorité au risk engine et à l'anti-lookahead
```

---

## Ce que le framework garantit

### Anti-lookahead
- indicateurs strictement causaux (aucune fenêtre centrée, aucun `shift(-n)`) ;
- alignement multi-TF sur l'**instant de disponibilité** : une bougie 4h ouverte
  à 08:00 n'est utilisable qu'à partir de 12:00 ;
- décision à la clôture de la barre `N`, exécution à l'**ouverture** de `N+1` ;
- warmup dérivé des lookbacks les plus longs (EMA 200 en 4h ⇒ 8 000 barres 15m) ;
- test automatique : du bruit est injecté dans le futur, les signaux passés
  doivent être bit-à-bit identiques.

### Risque (invariants, pas suggestions)
| Contrainte | Valeur | Comportement |
|---|---|---|
| levier max | 10 | refus au-delà ; levier réduit si le stop est large |
| marge par trade | 20 % equity | plafond **secondaire** (le sizing est risk-based) |
| positions simultanées | 2 | refus au-delà |
| DD journalier | −6 % | flat + halte jusqu'à 00:00 UTC |
| DD hebdomadaire | −15 % | flat + halte jusqu'à lundi 00:00 UTC |
| DD mensuel | −25 % | flat + halte jusqu'au 1er du mois |
| kill switch | −60 % (HWM global) | arrêt définitif, reset manuel |
| verrou de profit | +38 % → plancher +25 % | flat + halte du mois |
| take profit mensuel | +110 % | flat + halte jusqu'au mois suivant |
| stop loss | obligatoire | aucune position sans SL enregistré |

Une violation d'invariant lève une exception et **arrête** le backtest. Un refus
d'ordre est journalisé et n'arrête rien.

### Sizing risk-based (§6.1 du cahier des charges)
```
risk_per_trade  = min(1,5 % × equity, budget résiduel jour/semaine/mois)
quantité        = risk_per_trade / distance_au_stop
marge           = notionnel / levier      ≤ 20 % equity (plafond secondaire)
levier effectif = min(10, 1 / (distance_stop × 1,5 + mmr + frais))
```
La dernière ligne résout l'incohérence signalée dans le cahier des charges : avec
un stop à 8 % et un levier 10, la liquidation (~9,6 %) se déclencherait avant le
stop. Le levier est donc réduit pour que la liquidation reste **au-delà** du stop.

### Réalisme d'exécution
frais taker 0,05 % / maker 0,02 % · slippage composite (spread + ATR + impact de
taille) · funding réel toutes les 8h sur le notionnel · liquidation sur **mark
price** avec paliers de marge de maintenance · fills **au travers des gaps**
(un stop n'est pas servi à son niveau si la bougie ouvre en dessous) · latence
200-500 ms · rejets d'ordre · résolution intrabar 5m, sinon hypothèse pessimiste.

---

## Limites connues (assumées, pas cachées)

1. **Funding reconstruit** au-delà de ~3 mois : l'API publique OKX ne conserve
   pas plus. La reconstruction part de la prime perp/index, calibrée par OLS sur
   la période réellement disponible (R² ≈ 0,78-0,82). Une reconstruction n'est
   pas une mesure.
2. **Résolution intrabar en 5m**, pas en 1m (coût API). Le module
   `validation/intrabar_bias.py` mesure l'écart sur une sous-période au lieu de
   le supposer nul.
3. **CVD non implémenté** sur l'historique : les trades tick pluriannuels ne sont
   pas exposés par l'API publique. Une approximation bougie par bougie aurait
   donné l'illusion de l'information.
4. **Dominance BTC** approximée par une performance relative (pas de
   capitalisations via l'API exchange).
5. **Pair trading** exprimé sur la jambe seule (le modèle de position ne gère pas
   la couverture beta simultanée sans consommer les deux emplacements).
6. **SOL** n'existe sur OKX qu'à partir de 2021-01.
7. **Binance et Bybit inaccessibles** depuis l'environnement d'exécution
   (HTTP 451 / 403) : OKX est la seule source.

---

## Discipline de l'audit

- L'out-of-sample est **verrouillé par le code** (`splits.oos_unlocked: false`).
  Toute lecture de 2024-2026 lève `OutOfSampleLocked` tant que le verrou n'est
  pas levé explicitement, avec motif.
- Chaque backtest exécuté pendant la recherche est enregistré dans
  `reports_out/trials.json`. Le Deflated Sharpe Ratio utilise ce compteur : on ne
  peut pas « oublier » les configurations perdantes au moment de conclure.
- Aucune conclusion sur moins de 200 trades par régime (marqué dans le rapport).
- Le rapport est publié **quelle que soit la conclusion**.
