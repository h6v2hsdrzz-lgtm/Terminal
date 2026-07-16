# Pronostic — Espagne vs Argentine, finale de la Coupe du monde 2026

Moteur de prédiction probabiliste pour la finale du 19 juillet 2026 au
MetLife Stadium (East Rutherford). Zéro dépendance, Node ≥ 18.

```bash
node pronostic/cli.mjs            # 512 000 finales simulées (~2 s)
node pronostic/cli.mjs --fast     # 64 000 (~0,3 s)
node pronostic/cli.mjs --json     # sortie machine
node pronostic/cli.mjs --no-crowd # neutralise le public pro-argentin
node pronostic/cli.mjs --raw      # sans ajustements contextuels
node pronostic/cli.mjs --seed 7   # autre graine (résultats reproductibles)
node pronostic/test.mjs           # 9 tests d'invariants
```

## Verdict (graine par défaut, 512 000 simulations)

| Issue | Probabilité |
|---|---|
| **Espagne championne** | **66,8 %** — IC 90 % : [56 % ; 76 %] |
| Argentine championne | 33,2 % |
| Espagne / nul / Argentine à 90' | 50,9 % / 31,1 % / 17,9 % |
| Score le plus probable à 90' | **1-0** (16,7 %), puis 1-1, 0-0, 2-0 |
| Prolongation | 31,1 % |
| Tirs au but | 18,4 % — et l'Argentine y gagne 60 % du temps |

L'« exactitude » est mathématiquement impossible : l'issue d'un match est une
variable aléatoire, pas une constante. L'entropie de cette finale vaut
0,92 bit sur un maximum de 1 : c'est objectivement l'un des matchs les plus
incertains qu'on puisse construire. Ce que la sophistication achète, ce n'est
pas la certitude — c'est une distribution **calibrée**, **traçable** et
**munie de son incertitude**.

## Architecture du modèle (six étages)

### 1. Elo « vivant »

Point de départ : l'instantané officiel du 07/07/2026 — Espagne 2177 (n° 1
mondial), Argentine 2151 (n° 2). Les matchs joués ensuite sont rejoués avec le
barème eloratings.net : `K = 60` (Coupe du monde), multiplicateur de marge
(1 / 1,5 / (11+d)/8), espérance `We = 1/(1+10^(−ΔElo/400))`.

- Espagne : + Belgique 2-1, + France 2-0 → **2224**
- Argentine : + Égypte 3-2, + Suisse 3-1 a.p., + Angleterre 2-1 → **2193**

Écart final : +31 pour l'Espagne, ramené à **+19** après bonus de public
(−12 pts d'équivalent Elo, le MetLife étant attendu très majoritairement
argentin — constante documentée, désactivable par `--no-crowd`).

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
c'est-à-dire dans la zone de cette finale.

`T = 2,6` buts (moyenne des confrontations entre grandes nations en terrain
neutre), multiplié par la **prudence de finale** 0,90 : sur les huit dernières
finales de Coupe du monde, quatre étaient à 0-0 ou 1-1 après 90 minutes.

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

C'est le facteur décisif du pronostic : une défense qui n'a concédé qu'un but
en sept matchs (De Ketelaere, quart de finale) contre une arrière-garde qui a
pris deux buts du Cap-Vert **et** de l'Égypte.

### 4. Grille Dixon-Coles analytique

Probabilités exactes de chaque score à 90' : produit de deux Poisson corrigé
par le facteur `τ(x,y; ρ)` de Dixon & Coles (1997) avec `ρ = −0,10`, qui
gonfle 0-0 et 1-1 et dégonfle 1-0 et 0-1 — la dépendance bien documentée des
scores fermés. Grille tronquée à 12 buts puis renormalisée.

### 5. Simulation dynamique minute par minute

La grille analytique ne sait pas raconter une prolongation. La simulation, si :

- **Tempo** : intensité croissante (0,85 → 1,15) avec pics aux temps
  additionnels de chaque période ;
- **États de match** : l'équipe menée pousse (×1,12, jusqu'à ×1,37 après la
  60e), celle qui mène gère (×0,92, ×0,86 à +2) ;
- **Money-time** : multiplicateur propre à chaque équipe après la 75e,
  calibré sur les buts tardifs réels du tournoi — Argentine **1,28** (Enzo
  85e, Lautaro 90+3, remontada contre l'Égypte, deux victoires en
  prolongation), Espagne 1,10 (Merino 88e) ;
- **Prolongation** : intensité ×0,85, fatigue différentielle — l'Argentine a
  déjà 60 minutes de prolongation dans les jambes (×0,93) et un jour de repos
  de moins (facteurs de l'étage 3 du contexte) ;
- **Tirs au but** : tir par tir, 5 + mort subite, premier tireur au hasard.
  Conversion Espagne 69 % (tireurs 74 % − arrêts de Dibu Martínez 5 %),
  Argentine 76 % (78 % − Unai Simón 2 %). Barèmes justifiés dans
  `data.json` : l'Argentine a gagné ses trois dernières grandes séances,
  l'Espagne a perdu la finale de Ligue des nations 2025 aux tirs au but.

### 6. Incertitude paramétrique (couche bayésienne)

Un modèle qui donne « 66,8 % » sans barre d'erreur ment par omission. Les
512 000 simulations sont réparties en 64 lots ; chaque lot retire ses
paramètres : Elo ± 30, multiplicateurs de forme ± 6 % (log-normal), prudence
de finale ± 0,04, conversions aux t.a.b. ± 3 pts. La dispersion des lots
donne l'intervalle de crédibilité : **P(Espagne) ∈ [56 % ; 76 %] à 90 %**.

### Validation croisée interne

La grille analytique (étage 4) et la simulation dynamique (étage 5) sont deux
moteurs indépendants qui doivent raconter la même histoire à 90' : écart
maximal constaté **0,6 point** — vérifié par les tests.

## Sensibilité

| Variante | P(Espagne championne) |
|---|---|
| Modèle complet | 66,8 % |
| Sans public pro-argentin (`--no-crowd`) | 68,5 % |
| Sans aucun contexte (`--raw`) | 66,5 % |

Le pronostic est robuste : aucun réglage contextuel ne déplace l'issue de
plus de ~2 points. Ce qui porte le résultat, ce sont les données du tournoi.

## Données et sources

Toutes les entrées sont dans `data.json`, avec leurs sources :

- **Parcours réels** (FIFA.com, ESPN, Al Jazeera, NBC) — Espagne : 0-0
  Cap-Vert, 4-0 Arabie saoudite, 1-0 Uruguay, 3-0 Autriche, 1-0 Portugal,
  2-1 Belgique, 2-0 France. Argentine : 3-0 Algérie, 2-0 Autriche, 3-1
  Jordanie, 3-2 a.p. Cap-Vert, 3-2 Égypte, 3-1 a.p. Suisse, 2-1 Angleterre.
- **Elo** : footballratings.org / eloratings.net, instantané du 07/07/2026.
  Les Elo des adversaires sont des estimations (marquées `estimated`).
- **Effectifs** : aucun suspendu ; Romero et Paredes remis, Yamal à 100 %
  (Sports Mole, 15-16/07/2026).
- **Finalissima** du 27 mars 2026 : annulée — aucune confrontation directe
  récente entre les deux équipes.

## Limites assumées

- Pas de données xG publiques : le 0-0 contre le Cap-Vert pèse contre
  l'attaque espagnole alors qu'elle a tiré 27 fois — le modèle est
  volontairement conservateur.
- Les Elo adverses sont estimés à ±30 près (couverts par l'étage 6).
- Deux buts dans la même minute sont négligés (< 0,02 % par minute).
- Un modèle n'a jamais marqué de but : Messi, si. Huit fois ce tournoi.
