# Strategie long/short systematique sur perpetuels OKX — rapport final

Genere le 2026-07-25 21:56 UTC.
Univers : BTC-USDT-SWAP, ETH-USDT-SWAP, SOL-USDT-SWAP.
In-sample 2020-01-01 -> 2024-12-31 ; out-of-sample 2025-01-01 -> aujourd'hui.

## Verdict

**Objectif de 5.00 %/mois : NON ATTEINT.**

Levier requis pour 80 %/an : **13.69x**. Levier admissible sous la contrainte de drawdown mensuel de 25.00 % : **5.53x**.

Rendement mensuel median reellement atteignable a 5.53x : **0.00 %** (IC 95 % : 0.00 % a 0.00 %).

Contrainte bloquante : **limite_de_drawdown**.

> La limite de drawdown n'a pas ete relevee pour faire passer l'objectif, et aucun parametre n'a ete ajuste apres l'ouverture de l'out-of-sample. Le constat chiffre est le livrable.

Criteres go/no-go (§13) : **NON REMPLIS** — le passage en paper trading est refuse.

Essais consommes : **71 / 200**.

---

## 1. Donnees

| Symbole | 15m | 1H | funding | open interest |
|---|---|---|---|---|
| BTC-USDT-SWAP | 230,191 barres, 100.0 % | 57,548 | 7,119 reglements | 619,426 points |
| ETH-USDT-SWAP | 230,191 barres, 100.0 % | 57,548 | 7,119 reglements | 488,592 points |
| SOL-USDT-SWAP | 193,011 barres, 100.0 % | 48,253 | 6,032 reglements | 488,574 points |

**Substitution du funding.** L'API publique OKX ne retient qu'environ 3 mois de funding et 1,5 an d'open interest. L'historique de travail provient donc des dumps publics Binance USD-M : ce sont des taux reellement observes, pas une moyenne. L'ecart avec le funding OKX a ete mesure sur la fenetre de recouvrement disponible :

- BTC-USDT-SWAP : correlation 0.597, biais moyen -0.31 %/an, erreur absolue moyenne 3.47 %/an, accord de signe 76.9 % (212 reglements)
- ETH-USDT-SWAP : correlation 0.652, biais moyen +0.82 %/an, erreur absolue moyenne 3.60 %/an, accord de signe 78.8 % (212 reglements)
- SOL-USDT-SWAP : correlation 0.840, biais moyen +1.45 %/an, erreur absolue moyenne 3.79 %/an, accord de signe 82.5 % (212 reglements)

Consequence a retenir : le **niveau** du funding est bien reproduit (biais < 1 %/an), donc le cout cumule de portage est fiable. En revanche la correlation periode par periode (~0,6) est mediocre, ce qui rend le **z-score** du modulateur de funding plus bruite qu'il ne le serait sur des donnees OKX natives. Le modulateur doit donc etre juge sur sa contribution defensive, pas sur une precision de timing.

---

## 2. Validation du moteur

Resultat : **tous les tests passent**.

| Test | Resultat |
|---|---|
| T1_buy_and_hold_fidelity | OK |
| T2_costs_degrade | OK |
| T3_funding_sign | OK |
| T4_random_control_loses | OK |
| T5_leverage_cap | OK |
| T6_drawdown_halts | OK |
| T7_no_lookahead_features | OK |

Controle negatif (§11.8) : sur 30 strategies a entrees aleatoires avec le meme sizing et les memes couts, rendement moyen -38.56 %, 0.00 % de runs profitables. Le moteur ne fabrique pas de performance.

---

## 3. Briques, testees seules en in-sample

| Brique | Sharpe | mensuel median | DD max | trades | couts / PnL brut |
|---|---|---|---|---|---|
| ts_momentum | 0.197 | 0.17 % | -10.56 % | 4717 | 0.67 |
| cross_sectional | -0.369 | -0.59 % | -36.69 % | 1347 | 2.42 |
| cascade_reversal | -0.211 | 0.00 % | -0.76 % | 1 | 0.10 |
| portfolio | -0.038 | -0.31 % | -24.09 % | 1797 | 1.23 |

---

## 4. Calibration du levier (§8)

| Etape | Valeur |
|---|---|
| Sharpe hors echantillon, sans levier | 0.375 |
| Rendement annualise sans levier (R) | 5.85 % |
| Drawdown max sans levier | -13.86 % |
| DD mensuel p95 (Monte Carlo) | 4.52 % |
| L_objectif = 0.80 / R | 13.69x |
| L_risque = limite DD / DD_p95 | 5.53x |
| L_max | 10.00x |
| **L_final** | **5.53x** |

L'objectif de 5 %/mois N'EST PAS atteignable sous ces contraintes. Levier requis 13.69x, levier admissible 5.53x. Cause : la limite de drawdown mensuel de 25 % est la contrainte bloquante : le levier requis pour atteindre 80 %/an ferait sortir le drawdown mensuel attendu de son enveloppe autorisee. Rendement mensuel median reellement atteignable a 5.53x : 0.00 %. La limite de drawdown n'a pas ete relevee pour faire passer l'objectif.

### Confrontation au chemin realise — correction importante

Le compte ne **survit** qu'aux leviers 1x, 1.5x : au-dela de **1.5x**, le coupe-circuit global de -40 % du high-water mark se declenche et l'arret est definitif.
Le premier levier fatal est **2x**, tres en dessous du L_final de 5.53x issu de la formule.

| Levier | DD mensuel p95 (Monte Carlo) | DD max reellement observe | compte tue |
|---|---|---|---|
| 1x | -4.70 % | -24.05 % | non |
| 1.5x | -6.18 % | -39.03 % | non |
| 2x | -4.21 % | -40.05 % | oui |
| 5.5x | -5.56 % | -40.80 % | oui |
| 10x | -5.66 % | -39.96 % | oui |

**Lecture.** Le drawdown mensuel estime par bootstrap par blocs tourne autour de 5 %, alors que le drawdown reellement subi va de 24 % a 40 %. L'ecart est d'un facteur cinq a huit, et il est systematique.

La cause est methodologique, pas numerique : le bootstrap par blocs de 24 heures preserve l'autocorrelation intra-journaliere mais **detruit la persistance des tendances sur plusieurs semaines**. Or ce sont precisement les series de pertes longues, et non les mauvaises journees isolees, qui produisent les drawdowns qui tuent un compte. En reechantillonnant des blocs independants, la simulation ne genere quasiment jamais de telles series.

**Consequence sur la conclusion.** Le levier admissible n'est pas 5,53x mais **au plus 1,5x**. L'objectif de 5 %/mois etait deja hors d'atteinte avec la formule ; il l'est encore plus largement une fois le levier confronte au chemin realise. La correction va donc dans le sens de la prudence.

> Cette confrontation utilise la table de sensibilite produite AVANT l'ouverture de l'out-of-sample : aucun parametre n'a ete modifie apres l'avoir vue. Il s'agit de lire correctement une mesure deja effectuee, pas d'une recalibration.

Table de sensibilite complete : `artifacts/leverage_sensitivity.csv` (levier 1 a 10 par pas de 0,5, avec rendement mensuel espere, drawdown attendu et probabilite de ruine estimee par Monte Carlo).

---

## 5. Out-of-sample (ouvert une seule fois)

Ouvert le 2026-07-25T21:54:18 UTC, levier applique 5.53x.

| Metrique | In-sample | Out-of-sample |
|---|---|---|
| CAGR | -9.95 % | -27.37 % |
| Rendement mensuel median | 0.00 % | -0.93 % |
| Sharpe | -0.738 | -0.954 |
| Sortino | -0.109 | -0.781 |
| Calmar | -0.243 | -0.684 |
| Drawdown max | -40.89 % | -40.01 % |
| Taux de reussite | 35.85 % | 40.58 % |
| Profit factor | 0.314 | 0.726 |
| Esperance (R) | -0.981 | -0.181 |
| Nombre de trades | 53 | 313 |
| Liquidations | 0 | 0 |
| Taux de fill maker | 76.79 % | 83.14 % |
| Couts / PnL brut | 0.159 | 1.687 |
| VaR 95 % | 0.00 % | -0.06 % |
| CVaR 95 % | -0.00 % | -0.19 % |
| VaR 99 % | -0.00 % | -0.25 % |
| CVaR 99 % | -0.09 % | -0.46 % |

Intervalle de confiance a 95 % du rendement mensuel median out-of-sample : -3.28 % a 0.00 %.

### Deflated Sharpe Ratio

- Sharpe out-of-sample annualise : -0.954
- Sharpe maximal attendu sous l'hypothese nulle apres 71 essais : 1.106
- DSR : 0.000 — p = 1.0000
- Significatif a p < 0,05 : **non**

### Alpha / beta contre BTC (§11.10)

- alpha annualise : -7.67 % (t = -2.39)
- beta : -0.002 — R² = 0.000

Un beta proche de zero avec un alpha significatif indique une performance reellement independante du marche ; un beta eleve indiquerait un simple pari directionnel amplifie par le levier.

### Benchmarks sur la meme fenetre

| Reference | CAGR | Sharpe | DD max |
|---|---|---|---|
| btc_hold | -21.33 % | -0.151 | -53.85 % |
| equal_weight_basket | -30.69 % | -0.153 | -65.50 % |
| btc_2x | -54.02 % | -0.201 | -83.05 % |
| **strategie** | -27.37 % | -0.954 | -40.01 % |

Pourcentage de mois battant BTC : 47.37 %.

### Performance par regime

| Regime | heures | rendement total | Sharpe |
|---|---|---|---|
| baissier | 16,093 | -2.62 % | -0.138 |
| haussier | 11,692 | -10.01 % | -0.902 |
| range | 24,134 | -27.88 % | -1.483 |

### Stress des couts (§11.7)

| Multiplicateur | CAGR | Sharpe | trades |
|---|---|---|---|
| x1.0 | -27.37 % | -0.954 | 313 |
| x1.5 | -27.49 % | -1.201 | 209 |
| x2.0 | -27.56 % | -1.375 | 147 |

### Monte Carlo sur l'ordre des trades

- drawdown max median : -43.52 %
- drawdown max au 95e percentile : -49.95 %
- pire drawdown simule : -65.99 %
- probabilite de rendement negatif : 100.00 %
- probabilite de ruine (DD <= 50 %) : 4.88 %

### Criteres go / no-go (§13)

| Critere | Exige | Observe | Resultat |
|---|---|---|---|
| sharpe_oos_min | 1.8 | -0.954 | ECHEC |
| dsr_significant | p < 0.05 | 1.000 | ECHEC |
| min_trades | 300 | 313 | OK |
| sharpe_degradation | < 0.35 | 0.292 | OK |
| profitable_regimes | 2 | 0 | ECHEC |
| survives_2x_costs | rendement net > 0 a couts x2 | -0.276 | ECHEC |

**Verdict : passage en paper trading REFUSE.**

---

## 6. Boucle de recherche (§16)

- essais consommes : **71 / 200**
- condition d'arret : **hypotheses_epuisees**

| Hypothese | configurations testees |
|---|---|
| baseline | 4 |
| H2 | 6 |
| H1 | 12 |
| H3 | 15 |
| H4 | 6 |
| H5 | 11 |
| H6 | 7 |
| H7 | 2 |
| H8 | 8 |

Les dix meilleures configurations in-sample :

| # | hypothese | Sharpe IS | mensuel median | trades | statut |
|---|---|---|---|---|---|
| 1 | baseline | 0.197 | 0.17 % | 4717 | baseline |
| 46 | H5 | 0.149 | -0.13 % | 1415 | rejected |
| 48 | H5 | 0.086 | 0.08 % | 1416 | rejected |
| 55 | H6 | 0.076 | -0.12 % | 1663 | rejected |
| 16 | H1 | 0.069 | 0.13 % | 1768 | rejected |
| 51 | H5 | 0.055 | -0.28 % | 1431 | rejected |
| 38 | H4 | 0.034 | -0.01 % | 1780 | rejected |
| 49 | H5 | 0.023 | -0.19 % | 1683 | rejected |
| 54 | H5 | 0.022 | -0.25 % | 1431 | rejected |
| 52 | H5 | 0.003 | -0.49 % | 1591 | rejected |

Le registre complet est dans `research/research_log.jsonl` : une ligne par configuration, append-only. C'est ce compteur qui alimente la penalite du Deflated Sharpe — plus on cherche, plus la barre monte.

---

## 7. Limites et pistes necessitant de nouvelles donnees

Les limites ci-dessous sont structurelles : elles ne se resoudront pas avec une configuration supplementaire sur les memes donnees.

1. **Univers cross-sectionnel de 3 actifs.** Le z-score en coupe ne dispose que de 3 points, le rang median est mecaniquement neutralise et la brique 2 degenere en un unique spread. L'extension a 8-10 perpetuels liquides est codee et mesuree (hypothese H2).

2. **Funding historique de substitution.** Le funding OKX au-dela de ~3 mois n'est pas disponible publiquement ; l'historique vient de Binance USD-M, avec un biais de niveau faible mais une correlation periode par periode d'environ 0,6.

3. **Open interest indisponible avant 2021.** La brique 3 exige une baisse confirmee de l'open interest : elle ne peut structurellement pas se declencher sur 2020.

4. **Pas de carnet d'ordres niveau 2.** Le taux de remplissage maker est modelise a partir de la penetration du prix dans la barre, pas de la file d'attente reelle. C'est la principale incertitude sur les couts.

### Les trois pistes les plus prometteuses

Elles demandent toutes de **nouvelles donnees**, pas de nouveaux parametres. Un edge absent des donnees OHLCV ne sortira pas d'une 201e configuration.

1. **Carnet d'ordres niveau 2 (snapshots horodates).** Permettrait de remplacer le modele de fill maker par une simulation de file d'attente, et surtout de detecter l'assechement de liquidite qui EST le mecanisme de la brique 3 — actuellement approxime par volume et open interest.

2. **Flux on-chain (entrees/sorties d'exchange, stablecoins).** Signal orthogonal au prix, avec un mecanisme economique clair : les mouvements de collateral precedent les mouvements de positionnement.

3. **Volatilite implicite des options (surface Deribit).** Le skew et la structure par terme sont des mesures directes du positionnement et du prix du risque de queue — exactement l'information que le funding capture mal et que la brique 3 cherche a exploiter.
