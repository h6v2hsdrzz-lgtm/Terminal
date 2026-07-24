# goldsilver — algo de trading XAU/USD + XAG/USD avec validation anti-overfitting

Backtest **réaliste** (spread bid/ask réel majoré, slippage, swap overnight,
worst-case intrabar, gaps) et surtout une **suite de validation** dont le seul
but est de répondre honnêtement à une question : *cette stratégie a-t-elle un
edge out-of-sample, oui ou non ?*

Le rendement n'est jamais une cible d'optimisation ici. La cible utilisateur
(5-6 %/mois) est traitée comme un **benchmark à mesurer**, pas une contrainte
à forcer. Les chiffres publiés sont les chiffres out-of-sample, coûts
pessimistes inclus — voir la section [Résultats](#résultats-mesurés) et le
verdict en bas.

## Installation

```bash
cd algo
python3 -m pip install -e .[dev]     # Python 3.11+
```

## Lancer un backtest complet

```bash
# 1) Télécharger ~7,5 ans de bougies 1h bid+ask (Dukascopy, gratuit, sans clé)
python3 -m goldsilver fetch

# 2) Backtest rapide, paramètres par défaut (métriques en console)
python3 -m goldsilver backtest

# 3) Validation complète (OOS, walk-forward, Monte-Carlo, noise, detrend,
#    sensibilité) + rapport HTML + résumé JSON dans reports/
python3 -m goldsilver validate

# Tests
python3 -m pytest
```

Tout est piloté par `config/default.yaml` (aucun paramètre en dur) :
`-c mon_fichier.yaml` pour une variante. Vous pouvez aussi fournir vos propres
CSV (`time,open,high,low,close,volume[,spread]`, UTC) aux chemins configurés —
y compris en 15m (`data.base_timeframe: "15m"`).

## Architecture

```
algo/
├── config/default.yaml       # TOUTE la configuration (données, coûts, stratégie, seuils)
├── src/goldsilver/
│   ├── data/                 # fetch Dukascopy (bid+ask -> spread réel), loader CSV,
│   │                         # nettoyage, resampling multi-TF SANS look-ahead
│   ├── strategy/             # Strategy ABC + trend_pullback (daily EMA + RSI 1h,
│   │                         # SL = k x ATR, TP = R:R x SL >= 1:3)
│   ├── engine/               # sizing en % de risque, coûts, backtester bar-par-bar
│   ├── metrics/              # CAGR, mensuel moyen ± écart-type, Sharpe, Sortino,
│   │                         # max DD, win rate, profit factor, expectancy
│   ├── validation/           # oos, walk_forward, monte_carlo, noise, detrend,
│   │                         # sensitivity — un module par méthode
│   ├── report/               # verdict à seuils explicites + rapport HTML plotly
│   └── pipeline.py           # le chemin de code UNIQUE data -> signaux -> engine
└── tests/                    # sizing/risque, SL/TP/gaps/swap, anti-lookahead, métriques
```

### Choix d'honnêteté intégrés au code

- **Anti-look-ahead structurel** : une bougie 1h ne voit que la dernière bougie
  daily *terminée* (`align_to_base`, décalage d'une bougie + jointure asof).
  Testé par un test d'invariance : ajouter des données futures ne change aucun
  signal passé.
- **Exécution pessimiste** : signaux exécutés à l'ouverture suivante ; SL et TP
  dans la même bougie ⇒ SL d'abord ; gap au-delà du SL ⇒ exécution au gap ;
  spread réel par bougie × multiplicateur pessimiste (1.3 par défaut) ;
  slippage sur stops/market ; swap nightly, triple le mercredi.
- **Argent ≠ or** : l'argent est plus volatil — le SL en ATR et le sizing en %
  de risque adaptent automatiquement la taille ; une position déjà ouverte sur
  le métal corrélé dans le même sens divise le risque de la seconde par 2
  (`corr_risk_factor`), avec plafond de risque cumulé.
- **Grille d'optimisation volontairement petite** (3×3×3) et objectif unique :
  moins de degrés de liberté = moins d'overfitting. Un jeu de paramètres qui
  fait < 30 trades est disqualifié.
- **Verdict à seuils écrits d'avance** dans le YAML (rétention Sharpe OOS ≥ 0.5,
  WFE ≥ 0.5, P(ruine) ≤ 5 %, plateau ≥ 0.5, etc.) : les seuils classent, ils ne
  s'optimisent pas.

## Méthodes de validation

| Module | Question posée |
|---|---|
| `oos.py` | Split 70/30 chronologique. Les paramètres (défaut ET optimisés-sur-train) tiennent-ils sur le test ? Dégradation = overfitting. |
| `walk_forward.py` | Ré-optimisation glissante (36 mois train / 6 mois test). L'equity chaînée des segments test est 100 % out-of-sample. WFE = rendement OOS / IS. |
| `monte_carlo.py` | Reshuffle + bootstrap des trades → distribution des drawdowns, P(ruine ≥ 30 %), percentiles de rendement. |
| `noise.py` | Bruit gaussien 0.1 × ATR sur les prix, 100 runs. Une stratégie qui meurt d'un bruit microscopique n'a jamais eu d'edge. |
| `detrend.py` | Dérive de fond retirée des prix. Ce qui reste est du timing ; ce qui disparaît n'était que « l'or montait ». |
| `sensitivity.py` | Heatmaps 2D autour des paramètres choisis. Plateau = robuste, pic isolé = ajusté au bruit. |

## Résultats mesurés

Run du 2026-07-22, données réelles Dukascopy 1h bid+ask **2019-01-01 →
2026-06-30** (~44 300 bougies tradables par actif), spread réel par bougie
× 1.3, slippage, swap, worst-case intrabar. Résumé chiffré commité dans
[`reports/summary_20260722_2350.json`](reports/summary_20260722_2350.json) ;
rapport HTML complet régénérable via `python3 -m goldsilver validate`.

### VERDICT : OVERFIT / PAS D'EDGE — 0/7 contrôles passés

La stratégie d'exemple (`trend_pullback` : tendance EMA 50 daily, pullback
RSI 40 en 1h, SL 2×ATR, TP à R:R 1:3) **n'a pas d'edge exploitable** sur
or + argent une fois les coûts réalistes appliqués. Les vrais chiffres :

| Mesure | Valeur RÉELLE |
|---|---|
| **Rendement mensuel OOS (params par défaut, 2024-03 → 2026-06)** | **−0.14 % ± 3.05 %/mois** |
| Cible utilisateur (benchmark mesuré, jamais forcé) | 5-6 %/mois → **non atteinte, très loin** |
| OOS : rendement total / Sharpe / PF / trades | −4.8 % / −0.09 / 0.97 / 385 |
| Backtest complet 7.5 ans (défaut) | −77 %, max DD 79 %, WR 21 %, PF 0.65 |
| Walk-forward (9 folds ré-optimisés) | 3/9 folds profitables, **−11.8 %/an** en OOS chaîné |
| Monte-Carlo bootstrap (trades OOS) | P(perte) 63 %, rendement p5 −28.6 % / p95 +29.4 % |
| Noise test (bruit 0.1×ATR, 100 runs) | **0 %** de runs profitables |
| Detrending (dérive ~16 %/an XAU, ~19 %/an XAG retirée) | Sharpe −1.4 → **−2.6** : le peu de positif n'était que la tendance |
| Sensibilité | plateau 0.00 : aucun voisinage de paramètres sain |

### Lecture honnête

1. **L'edge brut est quasi nul et les coûts l'achèvent.** Sur l'or seul,
   sans aucun coût : +21.9 % en 7.5 ans (Sharpe 0.27, longs seulement) ;
   avec coûts réalistes : −15.6 %. Le win rate observé (~21-27 %) est sous
   le point mort d'un R:R 1:3 (25 % avant coûts, ~27-28 % après).
2. **L'argent aggrave tout** : son spread médian mesuré (0.030 $ sur ~25 $,
   soit ~0.12 %) coûte ~6× plus cher que l'or en relatif, pour une
   volatilité supérieure — le portefeuille complet fait bien pire que l'or seul.
3. **Les shorts perdent structurellement** sur un marché en bull séculaire,
   et le detrending montre que les longs ne faisaient que surfer cette
   même tendance : il n'y a pas de timing, il y a du beta.
4. Le seul contrôle presque favorable (P(DD≥30 %) = 1 % en reshuffle) dit
   simplement que la stratégie perd *lentement* — risque de ruine faible
   parce que le sizing à 0.75 % fonctionne, pas parce que ça gagne.

**Réponse à la question posée : non, cette stratégie n'a pas d'edge
out-of-sample.** Le framework, lui, fait exactement son travail : il l'a
prouvé en 2 minutes de calcul, avant qu'un seul euro réel ne soit risqué.

---

## Itération 2 : trois hypothèses de marché, optimisation max, et la vérité

Suite à la demande « optimise tout pour le rendement maximum, minimum
5 %/mois » : deux nouvelles stratégies ont été construites (hypothèses
différentes, pas des réglages), les contraintes réelles de levier ajoutées
(or ×20, argent ×10), puis **2 225 combinaisons** de paramètres balayées par
`scripts/optimize_max_return.py` — chaque « optimum » étant rejoué
honnêtement (optimisation sur 70 % de l'historique, évaluation figée sur
les 30 % jamais vus). Résumés commités dans `reports/`.

### Verdicts de la validation complète (risque 0.75 %/trade)

| Stratégie | Verdict | Détail |
|---|---|---|
| `trend_pullback` (1h) | **OVERFIT / PAS D'EDGE** (0/7) | cf. section précédente |
| `ratio_reversion` (pair or/argent) | **OVERFIT / PAS D'EDGE** (1/7) | WF négatif (WFE −1.8), 0 % des runs bruités profitables, plateau 0. L'écart or/argent saute de régime en régime au lieu de revenir à la moyenne. |
| `daily_breakout` (Donchian daily long-only) | **FRAGILE** (6/7) | WFE 1.89, 67 % de folds WF profitables, 100 % des runs bruités profitables, plateau 1.0 — mais voir les réserves ci-dessous. |

### « Optimiser tout au rendement max » : mirage vs réalité

| Stratégie | A. Optimisé sur TOUT l'historique (mirage) | B. Même optimiseur sur 70 %, testé sur les 30 % jamais vus |
|---|---|---|
| trend_pullback | −6.0 % (rien ne rend le 1h profitable, même en 875 combos) | train −26 % → OOS +21.7 % (pur hasard de régime : le WF dit 3/9 folds) |
| ratio_reversion | +11.9 % | train −1.4 % → **OOS −0.5 %** |
| daily_breakout | +32.0 % | train +17.4 % → **OOS +8.3 %** (+0.30 %/mois) — mêmes paramètres retenus sur 70 % et 100 % : stabilité réelle |

### Le seul edge survivant, et son prix en risque

`daily_breakout`, paramètres choisis sur le train uniquement (Donchian 30,
EMA 50, SL 1.5×ATR daily, R:R 2.5 — l'optimiseur préfère un R:R < 1:3),
**période complète 2019-2026, tous régimes** :

| Risque/trade | Rendement mensuel moyen | σ mensuel | Max drawdown | Verdict pratique |
|---|---|---|---|---|
| 2 % | **+0.87 %/mois** | 3.4 % | **−18.8 %** | tradable (PF 1.97, WR 47 %, 118 trades) |
| 5 % | +2.11 %/mois | 8.9 % | −48.9 % | la moitié du compte part en drawdown |
| 10 % | +4.39 %/mois | 18.9 % | **−78.1 %** | compte détruit en pratique ; et toujours < 5 %/mois |

Sur la seule fenêtre OOS 2024-2026 (le régime le plus favorable de
l'histoire des métaux), 10 % de risque donne +9.1 %/mois — avec
**P(drawdown ≥ 30 %) = 30 %** en Monte-Carlo et des mois à ±20 %.

### Réserves honnêtes sur le breakout daily (à lire avant d'y croire)

1. Le contrôle « OOS profitable » du verdict FRAGILE n'a validé qu'**1 trade**
   au risque par défaut : avec des stops en ATR daily et un compte de 10 k$,
   les tailles calculées tombent souvent sous les minimums de lot
   (surtout les 50 oz d'argent) — le système ne devient actif qu'à ~2 %
   de risque. Preuve faible, pas preuve forte.
2. Le detrending ne laisse que **+0.05 %/mois** d'edge résiduel : l'essentiel
   du rendement EST la tendance séculaire des métaux. C'est un système
   long-only qui vit du bull ; dans un marché baissier ou en range
   prolongé, il s'assèche (au mieux) ou saigne en faux départs.
3. ~120 trades en 7.5 ans : échantillon petit ; les intervalles de
   confiance sont larges.

## Itération 3 : breakout 4h — premier verdict ROBUSTE, et sa frontière de risque

Même moteur de cassure Donchian + filtre EMA, déplacé du daily au **4h**
(`config/breakout_4h.yaml`) pour densifier l'edge (~4× plus de signaux, coûts
encore faibles). Verdict de la suite complète : **ROBUSTE, 6/7 contrôles** —
74 trades OOS (+16.1 %, Sharpe 1.19, PF 1.66, expectancy +0.53R), 8/9 folds
walk-forward profitables (WFE 1.42), 100 % des runs bruités profitables,
plateau de sensibilité 1.0, P(perte) bootstrap 3 %.

**Le contrôle qui échoue est le detrending (Sharpe détendu −0.27) : cet
edge EST la tendance haussière des métaux.** C'est un trend-rider discipliné,
pas une machine à rendement absolu — si le bull s'arrête, le filtre le met à
plat et il saigne lentement (−0.14 %/mois sur données détendues).

Frontière de risque mesurée (moteur réel, params par défaut jamais réglés
sur l'OOS) :

| Risque/trade | Toute période %/mois | DD hist | P(DD≥50 %) | OOS 2024-26 %/mois | DD OOS |
|---|---|---|---|---|---|
| 2 % | +1.01 % | −41 % | 0.4 % | +2.08 % | −13 % |
| **5 %** | +2.71 % | **−78 %** | **53 %** | **+5.41 %** | −36 % |
| 7.5 % | +4.13 % | −91 % | 92 % | +8.25 % | −51 % |
| 10 % | +5.68 % | −96 % | 99 % | +11.07 % | −61 % |

Lecture honnête : la fourchette « 4-5 %/mois à 5-15 % de risque » n'existe
que sur la fenêtre 2024-2026 (le meilleur régime de l'histoire des métaux)
et s'achète avec une chance sur deux de traverser −50 % sur un cycle
complet. Sur l'ensemble des régimes 2019-2026, le même système à 5 % de
risque fait +2.7 %/mois de moyenne avec un −78 % historique (le chop
2021-2022 broie les cassures). S'ajoute l'avertissement de test multiple :
c'est la 4ᵉ hypothèse essayée sur les mêmes 7.5 ans — la probabilité qu'un
« ROBUSTE » soit un survivant chanceux augmente à chaque itération de
recherche. Zone défendable pour un compte réel : **2-3 % de risque,
+1-2 %/mois d'espérance conditionnelle au régime haussier, −15 à −40 % de
drawdown à accepter.**

## Itération 4 : price-action / SMC (bougies excessives, gaps, FVG, liquidité)

Quatre hypothèses supplémentaires ont été codées (`strategy/price_action.py`)
et passées dans la MÊME validation, puis comparées à l'incumbent
(`scripts/compare_strategies.py`, résultats dans
`reports/strategy_comparison.json`) :

| Stratégie | Verdict | OOS %/mois | WFE | Noise+ | Detrend Sh | Plateau |
|---|---|---|---|---|---|---|
| **breakout_4h (incumbent)** | **ROBUSTE 6/7** | +0.57 % | 1.42 | 100 % | −0.27 | 1.0 |
| excessive_candle_reversion | OVERFIT 2/7 | +0.72 % | −0.10 | 3 % | −0.80 | 0.0 |
| gap_fill | OVERFIT 2/7 | −0.05 % | n/a (4 trades) | 28 % | +0.16 | 0.0 |
| fair_value_gap (SMC) | OVERFIT 1/7 | −0.06 % | −0.07 | 25 % | −0.70 | 0.0 |
| liquidity_sweep (SMC) | OVERFIT 0/7 | −0.35 % | −1.54 | 0 % | −1.54 | 0.0 |

**Aucune ne bat breakout_4h.** Le cas instructif est
`excessive_candle_reversion` : rendement OOS affiché *supérieur* (+0.72 %)
mais walk-forward négatif, 3 % seulement des runs bruités profitables (vs
100 %) et plateau de sensibilité nul — le +0.72 % est un accident de
l'échantillon, pas un edge. Les concepts SMC (FVG, liquidity sweep) et le
gap fill n'ont, sur ces métaux, aucun edge out-of-sample. Le mean-reversion
perd là où le trend-following gagne : cohérent avec le detrending, qui
disait déjà que le régime des métaux 2019-2026 est directionnel.

**Décision (règle fixée par l'utilisateur : garder l'ancien si le nouveau
est moins bon)** : on RESTE sur `breakout_4h`. Le code des 4 stratégies est
conservé (testé, réutilisable si le régime change), mais aucune ne pilote le
bot. Note honnête sur les **tests multiples** : 8 hypothèses ont maintenant
été essayées sur le même historique — même breakout_4h mérite son forward
test avant tout argent réel.

### Note sur « 2 % par trade + 7 positions simultanées »

Risque par trade fixé à 2 % (min = max = plafond dur). Concurrence : avec
**2 instruments** (or, argent) et une position par instrument, le maximum
réellement atteignable est **2 positions** — `max_open_risk_pct` passé à
`0.04` pour les autoriser toutes deux (mesuré : +1.01 %/mois tous régimes
contre +0.76 % à une position à la fois, DD 41 % vs 37 %). Atteindre 7
positions exigerait soit d'empiler plusieurs trades sur le même métal
(pyramidage — imprudent sur deux actifs quasi identiques, ≈ un seul pari
×3.5), soit d'ajouter ~5 instruments décorrélés (le moteur gère N actifs :
c'est la seule voie honnête vers plus de concurrence).

## Itération 5 : portefeuille décorrélé (S&P 500, WTI, BTC) + risque doublé

Pour chercher un edge par **décorrélation**, la même stratégie validée
(breakout 4h long-only) a été appliquée à 5 instruments de 4 classes
d'actifs — or, argent, S&P 500, pétrole WTI, Bitcoin (données Dukascopy
2019-2026, `scripts/portfolio_analysis.py`).

**La décorrélation est réelle au niveau des données** — corrélation des
rendements journaliers :

| | BTC | WTI | S&P500 | Argent | Or |
|---|---|---|---|---|---|
| **BTC** | 1.00 | 0.09 | 0.37 | 0.21 | 0.15 |
| **WTI** | 0.09 | 1.00 | 0.18 | 0.08 | 0.04 |
| **S&P500** | 0.37 | 0.18 | 1.00 | 0.25 | 0.13 |
| **Or** | 0.15 | 0.04 | 0.13 | 0.79 | 1.00 |

Tout est faiblement corrélé, sauf or/argent (0.79, même classe). **Mais**
la stratégie breakout **n'a aucun edge sur le S&P, le pétrole et le BTC** —
elle y perd (−0.91 %/mois), et diversifier dans des paris perdants dégrade
le portefeuille au lieu de l'améliorer :

| Univers (2 % / trade) | %/mois | Sharpe | Max DD | Verdict validation |
|---|---|---|---|---|
| Métaux seuls (or+argent) | **+0.91 %** | 0.56 | 40 % | (breakout_4h : ROBUSTE 6/7) |
| Non-métaux (S&P+WTI+BTC) | −0.91 % | −0.47 | 64 % | — |
| Portefeuille complet (5) | −0.32 % | −0.14 | 58 % | **OVERFIT 2/7** (même ré-optimisé OOS) |

**La leçon** : la décorrélation ne crée pas d'edge, elle ne fait que
combiner ceux qui existent. Ajouter des marchés décorrélés mais sur lesquels
la stratégie n'a pas d'edge propre ne diversifie que des pertes. Le
portefeuille complet, même avec ses paramètres ré-optimisés hors échantillon,
ressort **OVERFIT / PAS D'EDGE** — strictement pire que les métaux seuls.
**Décision (règle utilisateur) : on garde les métaux seuls.** Le code, les
données et `config/portfolio.yaml` restent comme résultat négatif documenté ;
brancher d'autres marchés exigerait de trouver, par marché, une stratégie
qui y a un vrai edge (le framework le teste — aucun raccourci).

### Risque doublé : 2 % → 4 % par trade

Sur la stratégie conservée (métaux), le risque par trade a été **doublé à
4 %** comme demandé — le plafond dur du moteur (`live/risk.py`) a été relevé
de 2 % à 4 % par décision explicite. Coût mesuré du doublement :

| Risque/trade | %/mois (métaux, full) | Max drawdown |
|---|---|---|
| 2 % | +0.9 % | ~40 % |
| **4 %** | **+2.0 %** | **~67 %** |

Le doublement double aussi le drawdown. À 4 %/trade, le vrai filet de
sécurité n'est plus le plafond mais les **kill switches** : le halt à −20 %
de drawdown et la limite de perte journalière −5 % (deux stops le même jour
= −8 % → halte) interviennent bien avant le −67 % théorique. C'est un choix
de risque assumé du propriétaire du compte, pas une recommandation.

### Conclusion sur l'objectif « minimum 5 %/mois »

**Non tenable, et aucun réglage ne le rendra tenable.** Les faits mesurés :
même à 10 % de risque par trade (levier ×20/×10 pleinement utilisé), la
moyenne tous-régimes reste sous 5 %/mois, au prix d'un drawdown historique
de 78 % et d'une probabilité de ruine inacceptable. Et un rendement mensuel
*minimum garanti* n'existe pour aucune stratégie : celle-ci, à ce niveau de
risque, a un écart-type mensuel de ±19 % — des mois à −30 % font partie du
contrat. Ce que les données autorisent honnêtement avec l'edge survivant :
**~0.9 %/mois de moyenne à 2 % de risque, drawdown ~19 %, sur un régime
historiquement favorable.** Quiconque promet mieux sur ces marchés vend la
colonne « mirage » du tableau ci-dessus.

## Exécution automatique : paper → DEMO → LIVE (verrouillé)

Le bot (`src/goldsilver/live/`) exécute la stratégie **validée** de
`config/breakout_4h.yaml` — le signal live est calculé par le MÊME code que
le backtest (loader/nettoyage/timeframes/Strategy/sizing partagés).

### Phase 1 (obligatoire) : paper trading

```bash
# 1) Compte IG DÉMO GRATUIT (source de données + futur mode demo).
#    Clé API : My IG > Paramètres > API. JAMAIS dans un fichier committé.
export IG_API_KEY="..."
export IG_IDENTIFIER="..."             # identifiant de connexion IG
export IG_PASSWORD="..."
export IG_ENV=demo                     # demo par défaut
export IG_ACCOUNT_ID="..."             # optionnel (sinon compte "préféré")
# (optionnel) alertes Telegram :
export TELEGRAM_BOT_TOKEN="..." ; export TELEGRAM_CHAT_ID="..."

# 2) Confirmer les epics IG de l'or et de l'argent sur VOTRE compte
#    (ils varient selon le compte/région) et les reporter dans config/live.yaml :
goldsilver-live find-epic or
goldsilver-live find-epic argent

# 3) Lancer le paper trading (config/live.yaml est en mode: paper par défaut)
goldsilver-live run                   # boucle : décision à chaque clôture 4h
goldsilver-live run --once            # un cycle (cron/systemd externe)

# Suivi
goldsilver-live status                # halte ? equity paper ? positions ?
goldsilver-live report                # forward test vs attentes du backtest
tail -f live_state/journal.jsonl      # chaque décision/ordre/fill/rejet
```

> **Contrats IG** : IG dimensionne les ordres en *contrats* (ex. 1 contrat
> or ≈ 100 oz), pas en onces. La conversion onces→contrats (arrondi au pas
> inférieur, minimum broker) est faite par l'adaptateur via
> `broker.ig.contracts` dans `config/live.yaml` — vérifiez `oz_per_contract`,
> `min_contracts` et `contract_step` contre `GET /markets/{epic}` de votre
> compte. Les données historiques IG ont un **quota hebdomadaire** : les
> bougies H1 sont mises en cache dans `live_state/cache/` et seuls les points
> manquants sont redemandés à chaque cycle.

Laisser tourner **plusieurs mois** (cible ≥ 30-50 trades). Le rapport
compare win rate, expectancy R, profit factor, fréquence et slippage réel
aux valeurs OOS du backtest et signale toute dégradation.

### Passage DEMO puis LIVE

- **DEMO** : `mode: demo` dans `config/live.yaml` → ordres réels sur le
  compte démo IG (SL/TP posés chez le broker, réconciliation à chaque cycle
  via l'historique de transactions : l'état du compte fait foi, jamais la
  mémoire du bot).
- **LIVE** : trois verrous indépendants, il les faut TOUS :
  1. `mode: live` dans la config ;
  2. `export GOLDSILVER_LIVE_ACK=JE-COMPRENDS-ARGENT-REEL` (+ `IG_ENV=live`
     et une clé API de compte réel) ;
  3. `goldsilver-live run --enable-live`.
  Une condition manquante = refus de démarrer. C'est volontaire.

### Garde-fous non négociables (codés en dur ou par défaut)

- **Plafond DUR de 2 % de risque par trade** (`live/risk.py`) : une config
  au-dessus fait refuser le démarrage, et chaque ordre est re-vérifié.
- **Filtre de régime** (`live/regime.py`, critère documenté — conséquence
  directe du test de detrending) : close > EMA100 4h, pente EMA ≥ 0 sur
  30 bougies, Efficiency Ratio ≥ 0.20 — sinon pause des nouvelles entrées
  (les positions ouvertes gardent leurs SL/TP broker).
- **Kill switches** : −5 % sur la journée, −20 % de drawdown depuis le
  plus-haut, 6 pertes consécutives → flatten + halte persistante
  (`goldsilver-live reset-halt` pour lever, action humaine).
- **R:R ≥ 1:3 exigé** à chaque ordre, sizing en % de risque, plafonds de
  levier par actif.
- **Erreur API** : retries avec backoff, puis cycle SANS action de trading
  (« ne pas trader » plutôt que « trader à l'aveugle » ; les SL/TP restant
  côté serveur, les positions restent protégées).

### Tout couper, tout de suite

```bash
touch KILL                            # prochain cycle : flatten + halte
goldsilver-live flatten               # immédiat : ferme tout + halte
# reprendre plus tard : rm KILL && goldsilver-live reset-halt
```

## Avertissements

Backtest ≠ avenir. Les hypothèses de coûts sont pessimistes mais pas
garanties (spread en période de news, slippage sur stops). Les swaps CFD
varient selon le courtier et les taux — vérifiez les valeurs de
`engine.costs.per_asset` contre votre courtier. Rien ici n'est un conseil en
investissement.
