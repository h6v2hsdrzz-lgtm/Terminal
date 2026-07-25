# Résultats de l'audit — perpétuels crypto en levier x10

> Ce document est publié **quelle que soit la conclusion**. Il rassemble les
> chiffres mesurés, pas ceux qu'on aurait aimé obtenir. Le rapport HTML complet
> (graphiques, tableaux détaillés) est produit par
> `python scripts/run_research.py --phase research`.

**Données** : OKX, perpétuels USDT-margined, 15m d'exécution.
BTC et ETH depuis 2020-01-01, SOL depuis 2021-01-22 (date de listing).
**In-sample** : 2020-01-01 → 2024-01-01. **Out-of-sample** : 2024-01-01 → aujourd'hui.

---

## 1. Configuration de référence (paramètres du YAML, conçus a priori)

| Mesure | Valeur |
|---|---|
| Trades | 216 |
| Rendement total | **−59,7 %** |
| CAGR | −20,3 % |
| Sharpe | **−1,78** |
| Max drawdown | −60,2 % |
| Kill switch global | **déclenché le 2020-08-31**, après 243 jours (17 % de la période) |
| PnL brut (avant coûts) | **−3 949 USDT** |
| Coûts totaux (frais + funding + slippage) | 5 979 USDT |
| PnL net | −5 967 USDT |
| Win rate | 34,3 % |
| Espérance | −0,34 R par trade |

Lecture : le kill switch −60 % coupe définitivement le compte au bout de huit
mois. Le CAGR et le Sharpe affichés décrivent donc une equity gelée sur 83 % de
la période — la seule conclusion recevable est que **cette configuration détruit
le capital avant la fin de la première année**.

Point décisif : **le PnL brut est négatif avant même les coûts.** Il ne s'agit
donc pas d'un edge trop petit pour survivre aux frais — il n'y a pas d'edge
directionnel dans cet assemblage de signaux sur cet échantillon. Aucun réglage
d'exécution (ordres limites, réduction de fréquence, taille) ne peut corriger
cela.

## 2. Sensibilité des paramètres — 18 combinaisons

| entry_threshold | atr_stop_mult | familles requises | Sharpe | trades |
|---|---|---|---|---|
| 0,45 | 1,5 | 2 | −1,13 | 346 |
| 0,45 | 2,0 | 2 | −1,37 | 330 |
| 0,45 | 3,0 | 2 | −1,44 | 583 |
| 0,35 | 3,0 | 2 | −1,46 | 525 |
| … | … | … | … | … |
| 0,25 | 3,0 | 3 | −2,26 | 255 |

**0 combinaison sur 18 obtient un Sharpe positif.** Étendue : −1,13 à −2,26,
médiane −1,81. La question « plateau ou pic isolé ? » ne se pose donc pas : il
n'y a pas de zone de performance à qualifier. C'est un résultat plus net qu'un
surajustement — la sensibilité aux paramètres n'est pas le problème.

Tendance lisible : plus le seuil d'entrée est **haut** (donc moins on trade),
moins la perte est grande. Signature d'une espérance négative par trade.

## 3. Contrôle d'inversion — écarter l'erreur de signe

| Version | Trades | PnL brut | PnL net | Rendement |
|---|---|---|---|---|
| Normale | 216 | −3 949 | −5 967 | −59,7 % |
| Opinions inversées (avant routage) | 17 | −106 | −316 | −3,2 % |

Inverser l'opinion de toutes les familles ne produit que 17 trades : les
contraintes de régime annulent presque tout, ce qui montre que **les entrées
viennent essentiellement du suivi de tendance dans les régimes directionnels**.
Ces 17 trades perdent également en brut. Aucun indice d'erreur de signe.

## 4. Répartition des régimes (in-sample)

| Régime | Part des barres |
|---|---|
| `range` | ~68 % |
| `trend_up` | ~15 % |
| `trend_down` | ~11 % |
| `high_vol_chaos` | ~6 % |

## 5. Qualité et limites des données

**Funding reconstruit** (l'API OKX ne conserve que ~3 mois) :

| Symbole | R² | pente | points réels | points reconstruits |
|---|---|---|---|---|
| BTC | 0,784 | 0,738 | 285 | 7 186 |
| ETH | 0,820 | 0,730 | 285 | 7 186 |
| SOL | 0,741 | 0,683 | 285 | 6 029 |

**Biais de résolution intrabar** (mesuré, oct. 2023 → janv. 2024, 343 trades) :

| Résolution | Rendement | Sharpe | barres ambiguës |
|---|---|---|---|
| 1m (vérité) | −45,67 % | −2,548 | 1 |
| 5m (utilisé) | −45,67 % | −2,548 | 1 |
| Hypothèse pessimiste | −47,62 % | −2,740 | 1 |

Une seule bougie ambiguë sur 343 trades : l'approximation 5m est **sans effet**
ici, et l'hypothèse pessimiste coûte 0,19 de Sharpe. Mesuré, pas supposé.

---

## 6. Réponse à la cible de +38 % mensuel

La cible était à traiter comme un objectif à tester, pas comme une contrainte de
conception — et elle n'a jamais servi de critère d'optimisation. Le résultat
mesuré est sans ambiguïté : **cette stratégie, telle que spécifiée, ne produit
pas +38 % mensuel ; elle produit une perte, et suffisamment vite pour déclencher
l'arrêt définitif au bout de huit mois.**

Ce que l'audit permet d'affirmer, et ce qu'il ne permet pas :

* **Affirmé** : l'assemblage « 7 familles + routage par régime + seuils fixes »
  n'a pas d'edge directionnel exploitable sur BTC/ETH/SOL en 15m entre 2020 et
  2024, coûts inclus ou non.
* **Non affirmé** : qu'aucune stratégie de ce type ne puisse fonctionner. Le
  périmètre testé est celui du cahier des charges ; d'autres horizons, d'autres
  univers, ou une sélection de signaux fondée sur une hypothèse économique
  explicite plutôt que sur un catalogue d'indicateurs restent ouverts.

## 7. Ce que le framework a attrapé au passage

1. **Une fuite d'information massive** : `DatetimeIndex.view("int64")` renvoie
   des microsecondes sous pandas 3 ; l'alignement 4h associait donc à chaque
   barre la *dernière* bougie de tout l'échantillon. Détectée par le test
   d'alignement, invisible autrement — et elle aurait « amélioré » les résultats.
2. **Un embellissement de stop** : les stops étaient servis à leur niveau même
   quand la bougie ouvrait au travers. Corrigé (fill à l'ouverture).
3. **Un warmup insuffisant** : 500 barres au lieu des 8 000 nécessaires à une
   EMA 200 en 4h — les premiers mois auraient tradé sur des features vides.
4. **Un cache trop permissif** : le contrôle d'inversion renvoyait des résultats
   identiques à la version normale, parce que le cache de features ignorait les
   paramètres modifiant le cœur du calcul.

---

*Les sections walk-forward, k-fold purgé, Monte Carlo, Deflated Sharpe,
benchmarks, stress des coûts et out-of-sample figurent dans le rapport HTML
généré (`reports_out/rapport_audit.html`) et dans `reports_out/tables/*.csv`.*
