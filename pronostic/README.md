# Pronostic — dernières affiches de la Coupe du monde 2026

Moteur de prédiction probabiliste générique (deux équipes A/B), calibré sur
les données réelles du tournoi. Deux affiches fournies :

- **Finale** — Espagne vs Argentine, 19/07/2026, MetLife Stadium (`data.json`)
- **Petite finale** — France vs Angleterre, 18/07/2026, Hard Rock Stadium,
  Miami (`data-petite.json`)

Zéro dépendance, Node ≥ 18.

```bash
node pronostic/cli.mjs                    # finale : 512 000 simulations (~2 s)
node pronostic/cli.mjs --match petite     # petite finale France-Angleterre
node pronostic/tickets.mjs                # évaluation des combinés (tickets.json)
node pronostic/cli.mjs --fast             # 64 000 simulations (~0,3 s)
node pronostic/cli.mjs --json             # sortie machine
node pronostic/cli.mjs --no-crowd         # neutralise le bonus de public
node pronostic/cli.mjs --raw              # sans ajustements contextuels
node pronostic/cli.mjs --seed 7           # autre graine (reproductible)
node pronostic/test.mjs                   # 13 tests d'invariants
```

## Verdicts (graine par défaut, 512 000 simulations)

### Finale — Espagne vs Argentine (dim. 19/07)

| Issue | Probabilité |
|---|---|
| **Espagne championne** | **66,8 %** — IC 90 % : [56 % ; 76 %] |
| Argentine championne | 33,2 % |
| Espagne / nul / Argentine à 90' | 50,9 % / 31,1 % / 17,9 % |
| Score le plus probable à 90' | **1-0** (16,7 %), puis 1-1, 0-0, 2-0 |
| Prolongation / tirs au but | 31,1 % / 18,4 % — l'Argentine gagne 60 % des séances |

### Petite finale — France vs Angleterre (sam. 18/07)

| Issue | Probabilité |
|---|---|
| **France 3e** | **65,3 %** — IC 90 % : [52 % ; 78 %] |
| Angleterre 3e | 34,7 % |
| France / nul / Angleterre à 90' | 50,2 % / 27,5 % / 22,3 % |
| Score le plus probable à 90' | **1-1** (13,0 %), puis 2-1, 1-0 |
| Mbappé marque (s'il joue) | 57,7 % — cote juste 1,73 |
| Mbappé marque ET la France gagne à 90' | 39,3 % (36,2 % risque de repos inclus — cote juste 2,76) |

L'« exactitude » est mathématiquement impossible : l'issue d'un match est une
variable aléatoire, pas une constante. L'entropie de chacune de ces affiches
dépasse 0,9 bit sur un maximum de 1. Ce que la sophistication achète, ce n'est
pas la certitude — c'est une distribution **calibrée**, **traçable** et
**munie de son incertitude**.

## Architecture du modèle (six étages)

### 1. Elo « vivant »

Point de départ : l'instantané du 07/07/2026 — Espagne 2177 (n° 1 mondial),
Argentine 2151 (n° 2), France ≈ 2085 et Angleterre ≈ 2055 (estimations). Les
matchs joués ensuite sont rejoués avec le barème eloratings.net : `K = 60`
(Coupe du monde), multiplicateur de marge (1 / 1,5 / (11+d)/8), espérance
`We = 1/(1+10^(−ΔElo/400))`.

- Espagne : + Belgique 2-1, + France 2-0 → **2224**
- Argentine : + Égypte 3-2, + Suisse 3-1 a.p., + Angleterre 2-1 → **2193**
- France : + Maroc 2-0, − Espagne 0-2 → **2077**
- Angleterre : + Norvège 2-1 a.p., − Argentine 1-2 → **2049**

En finale, l'écart +31 est ramené à **+19** par le bonus de public (−12 pts
d'équivalent Elo, MetLife très majoritairement argentin — désactivable par
`--no-crowd`). À Miami, public jugé neutre (`crowdEloBonusB: 0`).

### 2. Correspondance Elo → buts, auto-calibrée

Les moyennes de buts se partagent le total attendu `T` :

```
λ₁ = T/2 · exp(+a·d̃/400)      λ₂ = T/2 · exp(−a·d̃/400)
d̃  = 400·tanh(ΔElo/400)        (compression des écarts extrêmes)
```

La pente `a` n'est pas une constante magique : elle est résolue par dichotomie
pour que la grille de Poisson reproduise exactement l'espérance de gain Elo à
ΔElo = 100 (`a ≈ 0,956` pour `T = 2,6`). Le `tanh` corrige la surestimation
exponentielle contre les adversaires faibles et reste neutre près de 0 —
c'est-à-dire dans la zone de ces deux affiches.

`T = 2,6` buts (moyenne des confrontations entre grandes nations en terrain
neutre), multiplié par le **contexte de l'affiche** (`contextGoalMultiplier`) :
**0,90** pour la finale (quatre des huit dernières finales de CM étaient à
0-0 ou 1-1 après 90') et **1,15** pour la petite finale (3,4 buts de moyenne
sur les cinq dernières — match ouvert, sans calcul).

### 3. Forme attaque/défense sur le tournoi réel

Pour chacun des 7 matchs de chaque équipe : ratio buts observés / buts
attendus selon l'Elo de l'adversaire (les matchs avec prolongation comptent
120/90 de temps d'attente), pondération par récence (demi-vie 4 matchs),
puis rétrécissement empirique-bayésien vers 1 (`k = 3,5` attaque, `k = 5`
défense — les buts encaissés sont plus bruités).

|  | Attaque | Défense |
|---|---|---|
| Espagne (13 marqués, **1 encaissé**) | 0,943 | **0,637** |
| Argentine (19 marqués, 7 encaissés) | 1,001 | 1,173 |
| France (16 marqués, 4 encaissés) | 0,974 | 0,847 |
| Angleterre (14 marqués, 8 encaissés) | 0,946 | 1,102 |

C'est le facteur décisif de la finale : une défense qui n'a concédé qu'un but
en sept matchs (De Ketelaere, quart de finale) contre une arrière-garde qui a
pris deux buts du Cap-Vert **et** de l'Égypte.

### 4. Grille Dixon-Coles analytique + marché « buteur vedette »

Probabilités exactes de chaque score à 90' : produit de deux Poisson corrigé
par le facteur `τ(x,y; ρ)` de Dixon & Coles (1997) avec `ρ = −0,10`, qui
gonfle 0-0 et 1-1 et dégonfle 1-0 et 0-1 — la dépendance bien documentée des
scores fermés. Grille tronquée à 12 buts puis renormalisée.

Le marché « X marque (et son équipe gagne) » est pricé par **amincissement de
Poisson** : si la star signe une part `s` des buts de son équipe, alors
`P(star marque | k buts) = 1 − (1−s)^k`, sommé sur la grille. Mbappé a marqué
**8 des 16 buts français** du tournoi (`s = 0,50`, doublés contre le Sénégal,
l'Irak et la Suède, puis Paraguay et Maroc) ; Messi 8 des 19 argentins
(`s = 0,42`). La probabilité de titularisation (`playProbability`) couvre le
risque de mise au repos — faible pour Mbappé : à 8 buts contre 8 pour Messi,
le Soulier d'or se joue samedi, la veille de la finale de Messi.

### 5. Simulation dynamique minute par minute

La grille analytique ne sait pas raconter une prolongation. La simulation, si :

- **Tempo** : intensité croissante (0,85 → 1,15) avec pics aux temps
  additionnels de chaque période ;
- **États de match** : l'équipe menée pousse (×1,12, jusqu'à ×1,37 après la
  60e), celle qui mène gère (×0,92, ×0,86 à +2) ;
- **Money-time** : multiplicateur propre à chaque équipe après la 75e,
  calibré sur les buts tardifs réels du tournoi — Argentine **1,28** (Enzo
  85e, Lautaro 90+3, remontada contre l'Égypte, deux victoires en
  prolongation), Espagne 1,10 (Merino 88e), France et Angleterre 1,10
  (neutre, pas de pattern documenté) ;
- **Prolongation** : intensité ×0,85, fatigue différentielle — l'Argentine a
  60 minutes de prolongation dans les jambes, l'Angleterre 30 ;
- **Tirs au but** : tir par tir, 5 + mort subite, premier tireur au hasard.
  Conversions issues des barèmes tireurs/gardien de `data*.json` : en finale
  Espagne 69 % vs Argentine 76 % (effet Dibu Martínez) ; en petite finale
  France 69 % vs Angleterre 73 % (effet Pickford, Euro 2024).

### 6. Incertitude paramétrique (couche bayésienne)

Un modèle qui donne « 66,8 % » sans barre d'erreur ment par omission. Les
512 000 simulations sont réparties en 64 lots ; chaque lot retire ses
paramètres : Elo ± 30 (± 35 pour la petite finale, Elo estimés), forme ± 6-7 %
(log-normal), contexte ± 0,04-0,06, conversions aux t.a.b. ± 3 pts. La
dispersion des lots donne l'intervalle de crédibilité.

### Validation croisée interne

La grille analytique (étage 4) et la simulation dynamique (étage 5) sont deux
moteurs indépendants qui doivent raconter la même histoire à 90' : écart
maximal constaté 0,6 pt (finale) / 1,5 pt (petite finale) — vérifié par les
tests.

## Évaluation de combinés (`tickets.mjs`)

`tickets.json` décrit des paris réels (marché, cote, mise, offre de cashout) ;
`tickets.mjs` croise les deux modèles pour pricer chaque jambe, chaque ticket
et le portefeuille complet — corrélations entre tickets et **annulation de la
jambe buteur** (joueur non aligné ⇒ cote 1,00) comprises. Marchés gérés :
`resultat90` (1X2 sur 90 minutes — une victoire aux t.a.b. ne paie pas) et
`buteurEtGagne`. Sortie : probabilité de gain, espérance de retour,
comparaison à l'offre de cashout, scénarios joints.

Constat sur les deux tickets du 16/07 : les jambes françaises sont bien
pricées (valeur ≈ 1,03-1,05), c'est la jambe « Argentine à 90' » (cote 3,60,
valeur 0,65 selon le modèle) qui plombe les deux combinés.

## Sensibilité (finale)

| Variante | P(Espagne championne) |
|---|---|
| Modèle complet | 66,8 % |
| Sans public pro-argentin (`--no-crowd`) | 68,5 % |
| Sans aucun contexte (`--raw`) | 66,5 % |

Le pronostic est robuste : aucun réglage contextuel ne déplace l'issue de
plus de ~2 points. Ce qui porte le résultat, ce sont les données du tournoi.

## Données et sources

Toutes les entrées sont dans `data.json` / `data-petite.json`, avec sources :

- **Parcours réels** (FIFA.com, ESPN, Al Jazeera, NBC, Olympics.com) —
  Espagne : 0-0 Cap-Vert, 4-0 Arabie saoudite, 1-0 Uruguay, 3-0 Autriche,
  1-0 Portugal, 2-1 Belgique, 2-0 France. Argentine : 3-0 Algérie, 2-0
  Autriche, 3-1 Jordanie, 3-2 a.p. Cap-Vert, 3-2 Égypte, 3-1 a.p. Suisse,
  2-1 Angleterre. France : 3-1 Sénégal, 3-0 Irak, 4-1 Norvège, 3-0 Suède,
  1-0 Paraguay, 2-0 Maroc, 0-2 Espagne. Angleterre : 4-2 Croatie, 0-0 Ghana,
  2-0 Panama, 2-1 RD Congo, 3-2 Mexique, 2-1 a.p. Norvège, 1-2 Argentine.
- **Elo** : footballratings.org / eloratings.net, instantané du 07/07/2026
  (Espagne 2177, Argentine 2151) ; France et Angleterre estimés. Les Elo des
  adversaires sont des estimations (champ `estimated`).
- **Buteurs** : FOX Sports / FIFA / Al Jazeera — Mbappé 8 buts (course au
  Soulier d'or à égalité avec Messi, 8).
- **Effectifs** : aucun suspendu pour la finale ; Romero et Paredes remis,
  Yamal à 100 % (Sports Mole, 15-16/07/2026).
- **Finalissima** du 27 mars 2026 : annulée — aucune confrontation directe
  récente Espagne-Argentine.

## Limites assumées

- Pas de données xG publiques : le 0-0 contre le Cap-Vert pèse contre
  l'attaque espagnole alors qu'elle a tiré 27 fois — le modèle est
  volontairement conservateur.
- Les Elo adverses (et FRA/ENG) sont estimés à ±30 près (couverts par
  l'étage 6).
- Deux buts dans la même minute sont négligés (< 0,02 % par minute).
- L'amincissement de Poisson suppose les buteurs interchangeables but à but ;
  la probabilité de victoire française est prise identique avec ou sans
  Mbappé dans le scénario d'annulation (légèrement optimiste).
- La motivation en petite finale est notoirement volatile : l'incertitude
  paramétrique y est élargie, pas éliminée.
- Un modèle n'a jamais marqué de but : Messi et Mbappé, si. Huit fois chacun
  ce tournoi.
