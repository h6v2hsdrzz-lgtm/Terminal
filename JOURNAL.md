# Journal de bord

Fichier de passation entre sessions (§17.3). Mis à jour à **chaque étape
terminée** : ce qui est fait, ce qui reste, les décisions prises et leur
raison, les points bloquants, la prochaine action.

**Protocole de reprise (§17.4)** — première chose à faire dans toute nouvelle
session, avant d'écrire la moindre ligne de code :

```bash
python -m okx_algo.run --status     # état, compteur d'essais, étapes faites
python -m okx_algo.run --resume     # reprend exactement où on s'est arrêté
```

Puis lire, dans l'ordre : ce fichier, `state/run_state.json`,
`research/research_log.jsonl` (**ne jamais remettre le compteur à zéro**),
`research/HYPOTHESES.md`.

---

## État au 2026-07-25

### Fait

| Étape | État | Artefact |
|---|---|---|
| Données OHLCV 15m/1H/4H/1D + mark + index + funding + OI | terminé | `data_store/` |
| Données OHLCV 1m | **en cours** (~3 h) | `data_store/ohlcv/*_1m.parquet` |
| Rapport de qualité des données | terminé | `artifacts/data_quality_report.md` |
| Validation du moteur (7 tests, §14) | terminé, **tous passent** | `artifacts/engine_selftest.md` |
| Tests unitaires (29) | terminé, tous passent | `okx_algo/tests/test_core.py` |
| Briques 1, 2, 3 + modulateur + portefeuille | codées | `okx_algo/strategies/`, `portfolio/` |
| Module de levier, validation, registre d'essais | codés | `okx_algo/leverage/`, `validation/`, `research/` |
| Hypothèses pré-enregistrées H1–H8 | écrites **avant** toute optimisation | `research/HYPOTHESES.md` |

### Reste à faire

1. Fin du téléchargement 1m (bloque la brique 3 et la résolution intrabar fine).
2. Baselines des 3 briques + portefeuille, sur données complètes.
3. Boucle de recherche §16 (H1, H3–H8) + étude d'univers H2.
4. Calibration du levier §8 sur les plis walk-forward.
5. Ouverture **unique** de l'out-of-sample + validation complète.
6. Rapport final.

---

## Décisions prises et leur raison

### Données

**Le funding et l'open interest historiques ne viennent pas d'OKX.** L'API
publique OKX ne retient qu'environ 95 jours de funding et 1,5 an d'open
interest — mesuré, pas supposé. Binance et Bybit sont géo-bloqués en REST
depuis cet environnement, mais les dumps statiques `data.binance.vision` sont
accessibles : ils fournissent le funding 8 h réel depuis 2020-01 et l'open
interest au pas 5 min depuis 2021-01.

Ce sont des taux **réellement observés**, pas une moyenne — la contrainte du §3
est donc respectée sur le fond. L'écart OKX/Binance est **mesuré** sur la
fenêtre de recouvrement disponible (212 règlements) et rapporté :

- corrélation 0,60 à 0,65 ; accord de signe 77 à 79 % ;
- **biais moyen inférieur à 1 %/an**, erreur absolue moyenne ~3,5 %/an.

Conséquence à garder en tête : le **niveau** du funding est fiable, donc le coût
de portage cumulé l'est aussi. En revanche le **z-score** du modulateur (§6) est
plus bruité qu'il ne le serait sur données OKX natives. Le modulateur doit être
jugé sur sa contribution défensive, pas sur sa précision de timing.

**Conséquence sur la brique 3** : pas d'open interest avant 2021, donc la
condition « ΔOI 1 h < −3 % » ne peut structurellement pas être satisfaite en
2020. La brique ne se déclenche pas cette année-là. C'est documenté, pas
contourné.

### Grille du moteur : 15 minutes

La brique 3 détecte des cascades sur une fenêtre de 15 min et son edge se
dissipe en quelques heures. Sur une grille horaire, la détection arriverait
jusqu'à 45 min en retard, ce qui détruirait précisément ce qu'elle cherche à
capter. Toute la chaîne tourne donc en 15 m, avec descente en 1 m pour la
résolution intrabar. Les briques 1 et 2 conservent leur cadence propre (H1/H4
et quotidienne) via `rebalance_timeframe`.

### Deadband — écart assumé par rapport à la lettre du §5

Le §5 fixe le deadband à 0,20 sur « la position cible normalisée dans
[−1, +1] ». Après vol targeting à 10 % annualisé, les poids réels vivent autour
de **0,05**. Deux lectures étaient possibles :

- seuil **absolu** sur les poids finaux → ne se déclenche jamais, la position
  reste figée jusqu'au changement de signe et le vol targeting est annulé ;
- seuil **relatif** (20 % de la taille de position) → churn massif, mesuré à
  ~5 allers-retours/jour et des frais supérieurs au PnL brut.

Retenu : le deadband s'applique **au signal normalisé dans [−1, +1]**, à
l'intérieur de la brique, avant la mise à l'échelle par la volatilité. C'est la
lecture littérale du §5 (« position cible normalisée dans [−1, +1] ») et la
seule échelle où un seuil de 0,20 a un sens dimensionnel. Le moteur ne conserve
qu'un filtre anti-poussière (`min_order_fraction`).

### Stop par défaut — dérivé, pas choisi

Le stop est calculé comme `k · √(horizon_jours) · ATR(24 h)` avec k = 3 et
horizon = 3 jours (médiane de l'horizon annoncé au §1). Il est **dérivé de
l'horizon du mandat, pas sélectionné sur les résultats** — distinction
importante vis-à-vis du §15. Un stop plus serré transformerait le filet de
sécurité en signal déguisé et tuerait une stratégie de momentum par
accumulation de sorties prématurées : l'effet a été mesuré (à 2,5 × ATR le PnL
brut passait de +10 k à −31 k).

### Ré-armement après stop

Un stop déclare la thèse de la position invalidée. Rentrer à nouveau 15 minutes
plus tard sur un signal inchangé n'est pas de la gestion du risque, c'est du
churn. Après un stop, le sens concerné est bloqué jusqu'à ce que le signal
change de signe ou revienne à zéro, avec une durée maximale de 24 h. C'était le
mécanisme qui détruisait le plus de PnL avant correction.

---

## Bugs trouvés et corrigés pendant la validation du moteur

Tous découverts par la couche d'assertion du §9 ou par les tests §14 — c'est
exactement leur raison d'être.

1. **Sorties pilotées par le signal non journalisées.** Seules les sorties sur
   stop créaient un enregistrement de trade. Toutes les statistiques de trade
   étaient donc calculées sur un échantillon biaisé vers les pires sorties.
2. **Stop recalculé à chaque rebalancement.** Il devenait un stop suiveur
   errant autour du prix, déclenché par le bruit. Le stop est désormais
   enregistré à l'ouverture et ne bouge plus.
3. **Plafond de positions franchi.** Les ordres émis dans la même barre, puis
   ceux déjà en carnet, n'étaient pas comptés : trois ouvertures simultanées
   passaient chacune le contrôle « 1 contre 2 ». Détecté par
   `assert_invariants`.
4. **Ordres limites jamais exécutés.** Un ordre non rempli était abandonné au
   lieu de rester en carnet jusqu'au timeout, et avec le maker désactivé aucun
   ordre ne basculait jamais en taker — le moteur ne tradait rien du tout.
5. **`rebalance_timeframe` ignoré.** Déclaré en configuration mais jamais
   implémenté : les briques reciblaient toutes les 15 min au lieu de leur
   cadence annoncée.
6. **Fenêtres exprimées en heures sur une grille 15 min.** Toutes les briques
   supposaient des barres horaires ; converties en barres.

---

## Résultats intermédiaires (in-sample 2020-2024, sans levier, sans 1 m)

| Brique | Sharpe | CAGR | DD max | Trades | Coûts / PnL brut |
|---|---|---|---|---|---|
| 1 — momentum TS | −0,01 | −0,6 % | −14,5 % | 4 720 | **111 %** |
| 2 — cross-sectionnel | −0,87 | −9,7 % | −40 % (kill switch) | 463 | 23 % |

Lecture, à confirmer sur données complètes :

- **Le signal de la brique 1 est sain** : son PnL théorique hors coûts est
  positif (+25 342 sur 5 ans, Sharpe brut ≈ 0,6, vol réalisée 11,5 % pour une
  cible de 10 %), parfaitement symétrique (49,3 % long / 49,3 % short) et
  insensible à l'ajout de retard — donc sans fuite du futur. **Ce sont les
  coûts qui consomment l'intégralité de l'edge**, pas le signal.
- **La brique 2 est le point faible**, exactement là où le §5 l'annonçait : sur
  3 actifs le z-score en coupe n'a que 3 points, le rang médian est neutralisé
  et la stratégie dégénère en un unique spread. Le kill switch de −40 % s'est
  déclenché en novembre 2021. C'est l'objet de l'hypothèse H2.

**Le point de décision du projet est donc le rapport coûts / edge**, ce qui
correspond exactement à l'hypothèse pré-enregistrée **H5** (fréquence de
rééquilibrage et largeur du deadband). Elle sera testée sous protocole, avec
comptage des essais — pas en bricolant le paramètre jusqu'à ce que le chiffre
passe.

---

## Prochaine action

Attendre la fin du téléchargement 1 m, puis :

```bash
python -m okx_algo.run --resume
```

qui enchaînera baselines → recherche → levier → out-of-sample → rapport, en
sautant tout ce qui est déjà terminé.
