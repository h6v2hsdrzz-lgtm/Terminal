# Décisions de méthode et leurs justifications

Ce document consigne les choix qui **ne sont pas** de simples réglages : ceux qui
changent ce que le backtest mesure. Chacun est daté par le code qui l'implémente,
pour qu'un lecteur puisse le contester point par point.

---

## 1. Le timeframe d'exécution est 15m, pas 1m

**Contrainte.** Le test de liquidation exige la série de *mark price*. Chez OKX,
elle se télécharge par lots de 300 barres : en 1m sur 2020→2026, cela représente
environ 11 500 requêtes par symbole (plusieurs heures, pour ~3,4 M de barres par
symbole). En 15m, environ 770.

**Décision.** Exécution en 15m — cohérent avec un horizon annoncé de « quelques
minutes à quelques jours » — et résolution intrabar en 5m sur tout l'historique.

**Ce qu'on perd, et comment on le mesure.** Quand stop et objectif sont touchés
dans la même bougie 15m, la séquence réelle est reconstituée en 5m ; si le 5m ne
tranche pas, l'hypothèse pessimiste s'applique (stop d'abord). Le module
`validation/intrabar_bias.py` **mesure** l'écart entre 1m, 5m et hypothèse
pessimiste sur une sous-période où le 1m a été téléchargé, au lieu de le déclarer
négligeable.

*Code : `config/default.yaml` (`data.execution_timeframe`),
`execution/simulator.py::resolve_exit`, `validation/intrabar_bias.py`.*

---

## 2. Le funding est reconstruit au-delà de trois mois

**Constat.** L'API publique OKX ne conserve qu'environ 3 mois d'historique de
funding (vérifié : la pagination s'arrête après ~285 enregistrements de 8h).
Binance et Bybit sont inaccessibles depuis l'environnement (HTTP 451 / 403).

**Pourquoi ne pas mettre zéro.** En levier x10 sur des trades de plusieurs jours,
le funding est un poste de coût majeur. Le mettre à zéro biaise le résultat dans
le sens favorable — exactement le type d'« simplification » que le cahier des
charges interdit.

**Décision.** Reconstruire le funding depuis la **prime perp vs index**, qui est
disponible sur tout l'historique :

1. prime horaire `p_t = (perp_t − index_t) / index_t` ;
2. moyenne sur la fenêtre de 8h précédant chaque règlement ;
3. régression `funding = a + b · prime` calibrée sur le chevauchement réel ;
4. application hors chevauchement, écrêtée à ±0,75 %/8h.

**Qualité obtenue.** R² ≈ 0,78 (BTC) et 0,82 (ETH) sur 285 points, pente ≈ 0,73.
Publié dans le rapport. Une reconstruction n'est pas une mesure : toute conclusion
sensible au funding doit être lue avec cette réserve.

*Code : `data/funding.py`.*

---

## 3. Le warmup est dérivé, pas choisi

Une EMA 200 en 4h porte 800 heures d'historique ; un percentile d'ATR sur 500
barres 4h en porte 2 000. Avec un warmup fixé « à 500 barres », les premiers mois
de chaque période sont tradés sur des features NaN, le régime retombe par défaut
sur `range`, et le début de l'échantillon est du bruit déguisé en résultat.

**Décision.** `effective_warmup()` calcule le warmup depuis les lookbacks les plus
longs de la configuration : 8 000 barres 15m, soit 83 jours. Chaque fenêtre de
backtest est en outre **pré-chargée** de cette durée, puis les résultats sont
découpés sur la fenêtre demandée — sinon chaque fenêtre de walk-forward perdrait
ses trois premiers mois.

*Code : `features/pipeline.py::effective_warmup`, `validation/runner.py::run_once`.*

---

## 4. Le levier est plafonné par la distance au stop

Le cahier des charges signale l'incohérence : 2 positions × 20 % de marge × levier
10 = 400 % de notionnel, et un mouvement adverse de 1,5 % suffit à atteindre la
limite journalière de −6 %.

**Décision.** Sizing **risk-based** (la taille découle du risque au stop, la marge
n'est qu'un plafond secondaire) *et* levier effectif réduit :

```
levier = min(10, 1 / (distance_stop × 1,5 + mmr + frais))
```

Sans cette seconde règle, un stop à 8 % avec un levier 10 (liquidation à ~9,6 %)
n'a aucune marge : la mèche qui touche le stop liquide la position. Le test
`test_liquidation_stays_beyond_stop` vérifie la propriété sur toute la plage de
distances de stop.

*Code : `risk/engine.py::_leverage_for_stop`, `tests/test_risk_engine.py`.*

---

## 5. Un stop n'est pas servi à son niveau quand le marché gappe

Le simulateur servait initialement les stops exactement au niveau demandé, même
lorsque la bougie **ouvrait déjà au-delà**. C'est l'un des embellissements
classiques du backtest : en crypto, les gaps de plusieurs pourcents à l'ouverture
d'une bougie sont fréquents.

**Décision.** `_gap_adjusted()` sert le stop (et la liquidation) au prix
d'ouverture quand celui-ci est plus défavorable que le niveau.

*Code : `execution/simulator.py::_gap_adjusted`.*

---

## 6. Ce que le CVD n'est pas

Le CVD exige les trades tick avec leur côté agresseur. L'API publique n'expose
pas cet historique sur plusieurs années. Reconstituer un « CVD » bougie par
bougie (en signant le volume par le sens de la bougie) aurait produit une série
d'apparence identique **sans le contenu informationnel** — c'est-à-dire un signal
qui semble marcher parce qu'il redécrit le prix.

**Décision.** Pas de CVD historique. La famille volume s'appuie sur OBV, volume
relatif, VWAP ancré et volume profile. `signals/volume.py::cvd_from_trades` reste
disponible pour le paper trading, où les trades tick sont collectables en direct.

---

## 7. Le compteur d'essais est automatique

Le Deflated Sharpe Ratio n'a de sens que si le nombre de configurations testées
est honnête. Le tenir à la main revient à s'auto-déclarer chanceux.

**Décision.** Chaque backtest exécuté pendant la recherche s'enregistre dans
`reports_out/trials.json` (nom, paramètres, Sharpe, nombre de trades, split). Le
DSR lit ce compteur. Les configurations perdantes comptent autant que les autres.

*Code : `validation/deflated_sharpe.py::TrialRegistry`, `validation/runner.py`.*

---

## 8. L'out-of-sample est verrouillé par le code

Une règle qui repose sur la discipline du chercheur n'est pas une règle.

**Décision.** `load_market_data(split="out_of_sample")` lève `OutOfSampleLocked`
tant que `splits.oos_unlocked` est `false`. L'ouverture exige un motif explicite
en ligne de commande (`--unlock-oos "…"`), consigné dans la configuration. Deux
lectures sont publiées à l'ouverture — la meilleure configuration de la grille
in-sample **et** la configuration par défaut conçue a priori — pour éviter de
faire passer un choix de grille pour une prédiction.

*Code : `data/loader.py::assert_split_allowed`, `scripts/run_research.py::phase_oos`.*

---

## 9. Un bug qui aurait tout invalidé

Le test d'alignement multi-timeframes a détecté que `DatetimeIndex.view("int64")`
renvoie des **microsecondes** sous pandas 3 (nanosecondes sous pandas 2). La
conversion en millisecondes était donc décalée d'un facteur 1000, plaçant les
bougies 4h en 1970 — ce qui faisait que `merge_asof` associait à chaque barre
d'exécution la **dernière** bougie 4h de tout l'échantillon. Autrement dit : une
fuite d'information massive, invisible dans les résultats (elle aurait « amélioré »
la performance), attrapée uniquement parce qu'un test vérifiait la propriété au
lieu de faire confiance au code.

**Décision.** `utils.dt_to_ms()` fait la conversion explicitement, et
`test_timestamps_round_trip_in_milliseconds` garde le comportement.

*Code : `utils.py::dt_to_ms`, `tests/test_no_lookahead.py`, `tests/test_data_quality.py`.*


---

## 10. Un incident de protocole, déclaré

Lors de la validation du harnais de paper trading contre l'API OKX en direct,
la version alors en place a **rejoué 9 599 bougies historiques** au démarrage
(comportement corrigé depuis : le démarrage à froid est désormais purement
prospectif, cf. §7 du README). Ces bougies couvrent le 2026-05-20 → 2026-07-25,
c'est-à-dire une fenêtre **située dans la période out-of-sample**.

Résultat observé lors de cet incident : 144 trades, equity 10 000 → 6 747 USDT
(−32,5 %), coupe-circuit mensuel déclenché.

Ce que cela implique, et ce que cela n'implique pas :

* **Déclaré** parce que la règle « l'OOS n'est regardé qu'une fois » vaut aussi
  quand la lecture est accidentelle. Passer l'incident sous silence rendrait la
  discipline d'audit décorative.
* **Aucun paramètre n'a été modifié** à la suite de cette observation. Les
  configurations soumises à l'out-of-sample formel ont été figées avant, à
  partir de la seule grille in-sample.
* Le chiffre va dans le même sens que l'in-sample, ce qui ne le rend ni plus ni
  moins valable : il est rapporté ici, pas utilisé comme argument.
