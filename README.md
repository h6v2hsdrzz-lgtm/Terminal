# Bullion Desk — positionnement institutionnel Or & Argent

Poste web qui répond à une seule question : **qui détient quoi sur l'or et
l'argent, et pourquoi ?**

Il n'existe pas de flux public des positions nominatives de telle banque ou de
tel hedge fund — ce n'est pas publié. La source qui s'en approche le plus est le
rapport hebdomadaire **Commitments of Traders** de la CFTC : chaque mardi, toutes
les positions déclarables du COMEX sont agrégées par catégorie d'opérateur et
publiées le vendredi. C'est la matière première de ce poste.

**Sans backend.** Le navigateur interroge directement les API publiques ; les
sources qui n'autorisent pas le CORS sont déposées en instantanés statiques par
GitHub Actions.

## Démarrage

```bash
python3 -m http.server 8000   # puis http://localhost:8000
```

Aucune installation, aucun compte. Une clé API Anthropic est nécessaire
uniquement pour l'agent d'analyse ; les sept vues fonctionnent sans.

## Sources

| Source | Données | CORS | Accès |
|--------|---------|------|-------|
| **CFTC** (Socrata) | Rapports COT, 1986 → aujourd'hui | ✅ | direct depuis le navigateur |
| **LBMA** | Fixings or/argent quotidiens depuis 1968 | ❌ | instantané `data/prices.json` |
| **FRED** (Fed de Saint-Louis) | 16 séries macro (taux réels, dollar, crédit…) | ❌ | instantané `data/macro.json` |
| **api.gold-api.com** / OKX | Spot XAU/XAG temps réel | ✅ | direct, avec repli |
| **Google Actualités** + fr.investing.com | Fil d'actualité francophone | ❌ | instantané `data/news.json` |
| **World Gold Council / FMI** | Réserves d'or officielles par pays | ❌ | instantané `data/reserves.json` |
| **Natural Earth** | Contours des continents | — | `data/land.json`, construit une fois |

Les sources sans CORS ne peuvent pas être lues par un navigateur depuis une page
GitHub Pages. Plutôt qu'un backend ou un proxy CORS tiers — fragile, et qui
verrait passer tout le trafic — `scripts/refresh_data.py` les récupère dans
GitHub Actions et dépose quatre JSON statiques dans `data/`. Le site reste
entièrement statique ; seule leur fraîcheur dépend du cron
(`.github/workflows/market-data.yml`, deux fois par jour en semaine).

`data/land.json` fait exception : il est construit une fois par
`scripts/build_land.py` à partir de Natural Earth. Le contour du monde ne
change pas deux fois par jour.

## Cohortes suivies

Le rapport **détaillé** (depuis 2006) sépare :

- **Producteurs / négociants** — mines, raffineurs, industriels. Couvrent une
  production physique : structurellement vendeurs.
- **Swap dealers** — les banques. Font le marché face aux indices et aux clients
  OTC puis se couvrent sur le COMEX ; leur short massif est le miroir mécanique
  du long des indices et des fonds, **pas** un avis baissier.
- **Managed money** — hedge funds et CTA. La cohorte directionnelle la plus
  suivie : c'est elle qui marque les extrêmes de sentiment.
- **Autres reportables** et **non déclarants** (petits porteurs).

Le rapport **historique** (depuis 1986) n'a que deux blocs — non-commerciaux et
commerciaux — mais vingt ans d'historique en plus, indispensables pour situer un
extrême dans le temps long. Les deux existent en « futures seuls » et
« futures + options ».

Sept marchés : or, argent, micro or, micro argent, platine, palladium, cuivre.

## Ce que le poste calcule

Un net brut ne dit rien seul. Chaque chiffre est replacé dans trois référentiels :

- **son histoire** — COT index (0 = plancher de la fenêtre, 100 = sommet),
  z-score, rang de percentile, sur 6 mois à tout l'historique ;
- **la taille du marché** — % d'open interest, net par opérateur, concentration
  des 4 et 8 plus gros, notionnel en dollars ;
- **le prix** — corrélation des variations, divergences, et un relevé
  descriptif de ce que le prix a fait après des configurations comparables.

Le **score de tension** (±100) agrège ces signaux en une lecture unique, et
affiche systématiquement ses composantes : un score qu'on ne peut pas décomposer
ne vaut rien.

### Statistiques, avec de quoi les juger

Un coefficient nu ne veut rien dire. Chaque corrélation affichée porte donc son
**intervalle de confiance à 95 %** (transformation z de Fisher), son verdict de
significativité, sa **variance expliquée**, et le coefficient de rang de
**Spearman** — insensible aux semaines extrêmes, nombreuses sur des variations
hebdomadaires de COT. La différence est concrète : sur l'or, les hedge funds
sortent à r = 0,34 significatif, et les producteurs à r = −0,15 dont l'intervalle
contient zéro. Affichés seuls, les deux chiffres auraient eu l'air comparables.

Trois mesures complètent la lecture d'un extrême :

- la **demi-vie** du positionnement, estimée par régression de retour à la
  moyenne — savoir qu'un index est à 95 ne dit pas s'il se dénoue en trois
  semaines ou en huit mois ;
- l'**asymétrie** et l'**aplatissement** de la distribution, qui disent à quel
  point le z-score, qui suppose une loi normale, est ici une approximation ;
- l'**autocorrélation** des flux hebdomadaires : les semaines s'enchaînent-elles
  (tendance) ou alternent-elles (bruit) ?

### Panneaux détaillés

Cohortes et séries macro sont **cliquables** partout où elles apparaissent : un
tiroir latéral ouvre tout ce que la donnée contient — position complète, nombre
d'opérateurs et net par opérateur, place dans l'histoire avec la distribution
des déciles, historique contre prix, rythme, corrélations, mouvements au-delà
de 2σ. Chaque tiroir de cohorte se termine par ce qui **n'est pas** publié.

### Le temps court, et ce qu'il faut pour l'atteindre

Descendre sous la semaine demande un instrument coté en continu avec un carnet
public. C'est l'**or tokenisé** (XAUT, PAXG) : adossé à du physique en coffre,
négocié 24 h/24, et servi par une API qui autorise le CORS. La vue **Flux
d'ordres** en tire des chandeliers de 5 minutes à 1 semaine, et surtout le
contenu des bougies — chaque transaction porte son côté agresseur, donc le
delta sépare ce qui a été acheté au marché de ce qui a été vendu. Le suivi du
spot est étroit mais imparfait : ce n'est pas le COMEX, et l'écran le rappelle.

**Ce qui n'existe pas et n'est pas simulé** : les liquidations sur l'or (aucun
marché public ne les publie pour ce sous-jacent), les stops et objectifs des
intervenants (transmis à personne), et les positions nominatives d'un
établissement (la CFTC agrège précisément pour qu'elles ne soient pas
identifiables).

### Le court terme, et sa limite

Le COT n'est pas un instrument court terme : il est hebdomadaire, et publié
trois jours après son arrêté. La vue **Court terme** exploite donc ce qui est
réellement court dedans — le flux de la semaine par cohorte, la vitesse de
rotation sur 1 à 13 semaines — et traite explicitement l'**angle mort** : entre
l'arrêté du mardi et l'instant présent, le positionnement bouge sans qu'aucune
donnée ne le montre.

Le prix, lui, est en direct. Une régression des variations hebdomadaires du net
sur celles du prix donne une sensibilité (β, en contrats par point de
pourcentage) qui permet d'extrapoler la dérive depuis l'arrêté. Deux garde-fous :
l'estimation n'est affichée que si la relation tient (r² ≥ 0,10), et le r² sur un
an est comparé à celui sur trois ans — quand il s'effondre, l'écran le dit, parce
que la cohorte se positionne alors sur autre chose que le prix et que
l'extrapolation devient fragile. C'est un ordre de grandeur, jamais un chiffre
publié.

## Ce que le COT ne voit pas, et où le regarder

Le rapport ne couvre que les contrats à terme américains. Trois moteurs
majeurs de l'or lui échappent : le gré à gré de Londres, les flux des ETF,
et les **achats de banques centrales**. Le troisième est le premier acheteur
structurel du métal depuis 2022, il se traite hors COMEX, et il est déclaré
au FMI avec plusieurs mois de retard.

La vue **Monde** est le seul endroit du poste où ce moteur est visible :
les réserves officielles projetées sur un globe orthographique — l'aire de
chaque disque est proportionnelle au tonnage —, le classement complet, et
surtout la part que chaque pays consacre à l'or dans ses réserves de
change. C'est cet écart qui compte : 83 % pour les États-Unis contre 9 %
pour la Chine ne décrivent pas la même contrainte d'achat future.

Le globe se tourne à la souris ou au doigt, chaque détenteur ouvre son
tiroir, et le tonnage y est converti en contrats COMEX pour donner l'ordre
de grandeur — un stock souverain pèse couramment plusieurs fois l'open
interest de tout le marché à terme.

## Les quatorze vues

| Vue | Contenu |
|-----|---------|
| **Vue d'ensemble** | Cartes de synthèse, répartition par cohorte, net contre prix, régime macro, actualité |
| **Analyse Or** | Les quatre plans (positionnement, macro, structure de prix, inter-métaux) avec leur concordance |
| **Court terme** | Flux de la semaine par cohorte, vitesse de rotation, angle mort depuis l'arrêté, prix quotidien |
| **Flux d'ordres** | Chandeliers 5m à 1W, delta acheteur/vendeur, carnet, profil de volume — sur or tokenisé |
| **Cohortes** | Tableau complet (longs, courts, net, Δ, % OI, biais, index, z, opérateurs, notionnel) + concentration |
| **Historique** | Nets de toutes les cohortes, open interest, concentration, COT index glissant |
| **Extrêmes** | Matrice index/z/percentile, rotations à plus de 2σ, basculements du net, configurations comparables |
| **Or / Argent** | Écart de positionnement normalisé et comparaison directe des deux métaux |
| **Saisonnalité** | Variation mensuelle sur 40 ans, écart-type, signal/bruit, saisonnalité du positionnement |
| **Comparateur** | Les 7 marchés sur une grille normalisée, classement de tension, poids en dollars |
| **Macro** | 16 séries FRED avec sparklines, régime, corrélations or et argent |
| **Monde** | Globe zoomable des réserves officielles, liste filtrable, concentration, grammes par habitant, agrégats régionaux, places de marché |
| **Alertes** | Seuils sur les mesures COT, évalués localement |
| **Actualité** | Fil francophone rangé en six catégories |

## Alertes et export

Les seuils sont évalués **dans le navigateur**, sur les données déjà chargées,
et stockés en `localStorage` : rien ne part sur un serveur, et rien ne suit
d'un appareil à l'autre. Conséquence assumée : une alerte s'allume quand on
ouvre le poste, elle ne réveille pas la nuit — un site statique n'a aucun
moyen de notifier, et l'écran le dit plutôt que de laisser croire à une
surveillance continue. Le COT étant hebdomadaire, un seuil ne peut de toute
façon changer d'état qu'au moment de la publication du vendredi.

Chaque panneau contenant un tableau porte un bouton **CSV**. L'export lit le
tableau affiché plutôt que de le reconstruire : ce qui sort est exactement ce
qui est à l'écran. Séparateur point-virgule et BOM UTF-8, pour qu'un tableur
français l'ouvre sans manipulation.

## Agent d'analyse

L'agent reçoit à chaque question un instantané JSON (~17 Ko) de **ce qui est
affiché à l'écran** : positionnement complet, score de tension et ses
composantes, régime macro, corrélations, divergences, analogues, réserves
officielles et actualité classée par catégorie. Il ne
devine rien — chaque chiffre qu'il cite se retrouve dans le panneau d'à côté.

Neuf analyses pré-câblées — lecture du COT, régime macro, interprétation des
news, synthèse & scénarios, cartographie du risque, arbitrage or/argent,
banques centrales, angle mort court terme, et une **thèse inverse** qui
construit l'argumentaire le plus solide possible contre la lecture que
suggère l'écran — plus un champ libre. Réponses **diffusées en flux**. L'appel part directement du navigateur
vers l'API Anthropic ; la clé reste en `localStorage` et ne transite par aucun
serveur intermédiaire.

## Architecture

```
index.html              structure
css/positions.css       thème sombre, accent doré
js/vendor/              TradingView Lightweight Charts™ v5 (Apache-2.0)
js/cot/cftc.js          client Socrata CFTC : marchés, colonnes, cache local
js/cot/metrics.js       COT index, z-scores, percentiles, divergences, analogues
js/cot/macro.js         instantanés FRED/LBMA/news + spot temps réel + régime
js/cot/charts.js        graphiques temporels et chandeliers (LWC v5)
js/cot/globe.js         projection orthographique, réserves, places de marché
js/cot/tape.js          bougies multi-échelles et flux d'ordres (OKX)
js/cot/agent.js         contexte structuré + API Anthropic en flux
js/cot/alerts.js        seuils de surveillance locaux, export CSV
js/cot/desk.js          orchestration et rendu des quatorze vues
scripts/refresh_data.py collecte des sources sans CORS → data/*.json
scripts/build_land.py   contours des continents → data/land.json (une fois)
```

Le dossier `algo/` contient un paquet Python indépendant (backtest et forward
test d'une stratégie or/argent), sans lien avec le poste web.

Le dossier `joie/` contient une seconde application, elle aussi indépendante :
un journal de suivi du niveau de joie quotidien (Next.js, Prisma, SQLite). Elle
a son propre `README.md` et son propre cycle de développement — le poste web
reste statique et sans build.

## Avertissements

- Projet indépendant, non affilié à la CFTC, à la LBMA, au World Gold Council
  ni à TradingView.
- Le COT est **hebdomadaire et différé** : arrêté le mardi, publié le vendredi.
  Ce n'est jamais une photographie du marché en temps réel, et il ne couvre que
  les contrats à terme américains — ni l'OTC de Londres, ni les ETF, ni les
  achats de banques centrales.
- Les statistiques sur configurations comparables sont **descriptives**, sur de
  petits échantillons d'épisodes non indépendants. Ce ne sont pas des prévisions.
- Les **réserves officielles** sont déclarées au FMI de façon volontaire et
  différée. Un tonnage stable ne prouve pas l'absence d'achat : plusieurs banques
  centrales ont annoncé des hausses de centaines de tonnes après des années de
  silence. Elles ne couvrent ni les ETF, ni les particuliers, ni les stocks des
  banques commerciales — moins d'un cinquième de l'or extrait à ce jour.
- Rien ici n'est un conseil en investissement.
