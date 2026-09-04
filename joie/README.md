# Journal de joie — Momo, Sam & Samy

**En ligne : https://journal-de-joie.vercel.app** — journal commun, ouvert à
tous, sans compte, et installable sur un écran d'accueil.

Application de suivi quotidien du niveau de joie de trois personnes, et mesure
de l'effet de deux déclencheurs : le **facteur biberon** et le **facteur plante
verte**.

Une saisie par personne et par jour, un tableau de bord qui compare les
journées « avec » et les journées « sans », et un journal exportable.

## Deux versions

| | `joie/` (cette application) | `joie/autonome/` |
|---|---|---|
| Stockage | PostgreSQL, par API Routes | le navigateur (`localStorage`) |
| Installation | un déploiement en un clic | aucune — un dossier statique |
| Journal commun à tout le monde | **oui** | non, chaque navigateur a le sien |
| Mise à jour entre navigateurs | ~1 seconde | aucune |
| Fonctionne sans réseau | non | oui, une fois installée |
| Pour qui | un journal partagé à plusieurs | essayer tout de suite, ou hébergement statique |

La version autonome tient dans `joie/autonome/` : aucune dépendance, aucune
construction, les graphiques sont du SVG écrit à la main. Ouvrez le fichier
dans un navigateur, ou déposez le dossier sur n'importe quel hébergement
statique. Les deux versions partagent le même modèle, les mêmes calculs et le
même jeu de démonstration.

### Ce que la version autonome sait faire

- **Lieu** sur chaque entrée, et une carte « lieu le plus joyeux » qui en découle.
- **Tout est configurable** : profils (cinq au plus), facteurs suivis, lieux,
  titre du journal, échelle de joie (1 à 5 ou 1 à 10), seuil de fiabilité,
  cartes affichées, décor.
- **Sept cartes** activables une à une : moyenne générale, une par profil,
  facteur le plus influent, lieu le plus joyeux, série de jours en cours,
  calendrier des dix dernières semaines, répartition des scores.
- **Quatre décors** — sobre, aurore, jardin, nuit — faits de taches de couleur
  floutées, animées ou non. Aucune image n'est chargée.

Le plafond de cinq profils n'est pas arbitraire : les teintes de série sont
validées ensemble sur la clarté, le chroma, la séparation en vision daltonienne
et le contraste, dans les deux thèmes. Une sixième ne passe plus les contrôles.

### Journal partagé et synchronisation

Publiée comme artefact Claude, l'application partage son journal : chaque
saisie et chaque réglage est publié, et **toutes les vues ouvertes basculent
sur la nouvelle version**. La pastille en haut de page dit toujours où l'on
en est — `Partagé`, `Envoi…`, `Lecture seule` ou `Local`.

Deux voies de publication, de la plus douce à la plus rustique :

1. **par fichier** — seul `data/journal.json` est réécrit, et la vue qui publie
   continue de tourner sans interruption ;
2. **par page** — le document entier est régénéré depuis son modèle et
   republié ; toutes les vues rechargent, la saisie en cours étant mise de côté
   dans `sessionStorage` pour survivre au passage.

Le document régénéré n'est jamais une sérialisation du DOM affiché : il est
reconstruit à partir du `<template>` intact, du texte du script et de l'état,
ce qui le rend stable d'une republication à l'autre.

Deux limites, dites franchement :

- **Sur GitHub Pages, il n'y a pas de synchronisation.** Un hébergement
  statique n'a pas de serveur ; chaque appareil garde son propre journal.
- **Un lecteur sans droit d'écriture voit tout, ne modifie rien.** La page le
  détecte à la première tentative et bascule en lecture seule plutôt que de
  laisser croire à un enregistrement.

### Installation sur l'écran d'accueil

Servie en HTTPS, la version autonome s'installe comme une application : elle a
son manifeste, ses icônes et un service worker qui la fait s'ouvrir sans
réseau. Ce dépôt étant publié par GitHub Pages, elle vit à
`…/joie/autonome/` une fois la branche fusionnée.

- **iPhone / iPad** — ouvrir l'adresse dans Safari (les autres navigateurs
  d'iOS ne savent pas installer), bouton Partager, « Sur l'écran d'accueil ».
- **Android** — ouvrir dans Chrome, menu ⋮, « Installer l'application ».
- **Bureau** — l'icône d'installation apparaît à droite de la barre d'adresse.

Une fois installée, l'application s'ouvre en plein écran, sans barre de
navigateur, et fonctionne hors réseau. Les données restent propres à chaque
appareil : deux téléphones ne partagent pas le même journal — c'est le prix de
l'absence de serveur.

```
joie/autonome/
├─ index.html              l'application entière
├─ manifest.webmanifest    nom, icônes, couleurs, mode plein écran
├─ sw.js                   service worker : ouverture sans réseau
└─ icone*.png|svg          icônes d'écran d'accueil, dont une masquable
```

## Mettre le journal en ligne, partagé

C'est la seule façon d'avoir un journal **commun** : une base de données que
tous les navigateurs interrogent. Deux services gratuits suffisent, sans carte
bancaire.

1. **Créer la base.** Sur [neon.tech](https://neon.tech) (ou Supabase), créer un
   projet et copier la chaîne de connexion — elle commence par `postgresql://`.
   Prendre celle **avec pool de connexions** : son hôte contient `-pooler`.
   L'adresse directe tient quelques connexions puis refuse les suivantes, ce
   qui se voit exactement quand plusieurs personnes consultent le journal en
   même temps. Garder le `?sslmode=require` qu'elle porte : il chiffre la
   liaison et le certificat est vérifié.
2. **Déployer.** [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fh6v2hsdrzz-lgtm%2FTerminal&project-name=journal-de-joie&repository-name=journal-de-joie&root-directory=joie&env=DATABASE_URL&envDescription=URL%20de%20connexion%20PostgreSQL%20%28Neon%2C%20Supabase%20ou%20Vercel%20Postgres%29&envLink=https%3A%2F%2Fgithub.com%2Fh6v2hsdrzz-lgtm%2FTerminal%2Fblob%2Fmain%2Fjoie%2FREADME.md)
   Le formulaire demande `DATABASE_URL` : y coller la chaîne de l'étape 1.

Le déploiement joue les migrations tout seul (`prisma migrate deploy` fait
partie du build) et rend une adresse publique, que tout le monde peut ouvrir
sans compte.

### Deux adresses de base, et pourquoi

| Variable | Adresse | Sert à |
|---|---|---|
| `DATABASE_URL` | **avec** pool (`-pooler`) | l'application : beaucoup de requêtes courtes |
| `MIGRATE_DATABASE_URL` | **directe** (sans `-pooler`) | les migrations, au build |

Prisma pose un verrou consultatif PostgreSQL avant de migrer. Ce verrou vit le
temps d'une *session* — or un pool en mode transaction ne garantit pas de
rester sur la même session d'une requête à l'autre : le verrou n'est jamais
obtenu, et la migration échoue au bout de dix secondes sur `P1002`. D'où la
seconde adresse.

Si un verrou reste malgré tout coincé — une session d'un déploiement précédent
qui ne s'est pas refermée —, la variable `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK`
à `true` fait sauter le verrou. Il ne protège que contre deux migrations
simultanées, ce qu'une chaîne de déploiement unique ne produit pas.

### Sur l'écran d'accueil

L'application sert son propre manifeste et ses icônes : depuis Safari sur
iPhone, Partager → « Sur l'écran d'accueil » ; depuis Chrome sur Android, menu
⋮ → « Installer l'application ». À la différence de la version autonome, celle-ci
montre à tout le monde **le même journal**.

Pour partir d'un journal garni plutôt que d'une page vide, une fois l'adresse
obtenue : `DATABASE_URL="…" npm run db:seed`.

## Synchronisation entre appareils

Chaque page ouverte demande au serveur, toutes les trois secondes, une
**empreinte** du journal — le nombre d'entrées et la date de la dernière
modification, quelques octets. Tant qu'elle ne bouge pas, rien n'est rechargé ;
dès qu'elle change, la page récupère le journal et se redessine, avec un
message discret. Mesuré entre deux navigateurs : une saisie arrive à l'autre en
une seconde environ.

Une pastille dans l'en-tête dit l'état : `Synchronisé`, ou `Hors ligne` si le
serveur ne répond plus — auquel cas l'affichage est conservé plutôt que vidé.

Pourquoi une interrogation régulière plutôt qu'une connexion permanente
(WebSocket, SSE) ? Parce que l'hébergement recommandé exécute l'application par
fonctions sans état : une connexion ouverte y coûte cher, et deux visiteurs
peuvent tomber sur deux instances différentes qui ne se parlent pas. Une
empreinte toutes les trois secondes marche partout, ne coûte presque rien, et
pour un journal de famille, trois secondes ne se voient pas.

## Démarrage local

Node 20 ou plus récent, et une base PostgreSQL. La plus rapide, avec Docker :

```bash
cd joie
npm run db:local   # démarre une base jetable sur le port 5433
npm install        # installe et génère le client Prisma
npm run db:setup   # joue les migrations
npm run db:seed    # facultatif : six semaines de données de démonstration
npm run dev        # http://localhost:3000
```

`npm run db:local:stop` arrête la base. Sans Docker, n'importe quel PostgreSQL
fait l'affaire : renseigner son URL dans `.env`.

`npm install` crée au passage un `.env` à partir de `.env.example` — sauf si
`DATABASE_URL` existe déjà dans l'environnement, auquel cas la configuration de
l'hébergeur est laissée intacte.

### Autres commandes

| Commande | Effet |
|---|---|
| `npm run build` / `npm start` | build de production, puis serveur |
| `npm test` | tests unitaires de l'analyse, des dates, de la validation et des exports |
| `npm run lint` | ESLint |
| `npm run db:migrate` | crée une migration après modification du schéma |
| `npm run db:studio` | Prisma Studio, pour inspecter la base |
| `npm run db:local` / `db:local:stop` | base PostgreSQL jetable dans Docker |

## Ce que fait l'application

**Saisie rapide** — date (aujourd'hui par défaut), profil, curseur de joie de 1
à 10, deux interrupteurs pour les déclencheurs, notes libres. Le couple
`(date, personne)` identifie une mesure : si elle existe déjà, le formulaire la
charge et annonce qu'il la modifiera, plutôt que d'écraser en silence.

**Indicateurs** — moyenne collective, moyenne de chaque personne avec sa
tendance sur sept jours, et la carte « déclencheur le plus influent », qui
retient le facteur au plus grand écart positif entre les journées avec et sans.

**Graphiques** — l'évolution des trois scores dans le temps sur une échelle 0-10
(fenêtre 30 / 90 jours ou tout l'historique), et la comparaison en barres
groupées « avec » contre « sans », au niveau collectif puis profil par profil.

**Journal** — tableau triable par date, personne ou score, filtrable par profil,
période, état des déclencheurs et recherche dans les notes ; modification et
suppression ligne à ligne ; export CSV ou JSON de tout ce que les filtres
laissent passer.

Le thème clair / sombre suit le système par défaut et retient le choix manuel.

Dans la version autonome, l'export choisit son chemin selon l'endroit où la page
tourne : la capacité de l'hôte quand elle est publiée, un téléchargement
classique sur une page web ordinaire, et à défaut le contenu affiché pour être
copié.

## Architecture

```
joie/
├─ prisma/
│  ├─ schema.prisma        modèle Entree (PostgreSQL), unicité (date, personne)
│  ├─ migrations/          migrations SQL versionnées
│  └─ seed.ts              jeu de démonstration déterministe
├─ src/
│  ├─ app/
│  │  ├─ api/entrees/      GET, POST · PATCH, DELETE sur /:id
│  │  ├─ api/version/      empreinte du journal, pour la synchronisation
│  │  ├─ layout.tsx        métadonnées, thème appliqué avant la peinture
│  │  ├─ page.tsx          composant serveur : charge le journal, rend l'app
│  │  └─ globals.css       palette, thème sombre, curseur de joie
│  ├─ composants/          formulaire, indicateurs, graphiques, journal,
│  │                       et la boucle de synchronisation
│  └─ lib/
│     ├─ analyse.ts        moyennes, deltas, séries — fonctions pures
│     ├─ date.ts           ISO en base, JJ/MM/AAAA à l'écran
│     ├─ validation.ts     partagée entre le formulaire et l'API
│     ├─ export.ts         CSV (point-virgule, BOM) et JSON
│     ├─ depot.ts          seul module qui connaît Prisma
│     └─ api.ts            appels réseau côté navigateur
└─ tests/                  tests unitaires (node:test)
```

**Next.js 16** (App Router), **React 19**, **Tailwind CSS 4**, **Recharts**,
**Lucide**, **Prisma 7** sur **PostgreSQL**.

### Deux formats de date, volontairement

`AAAA-MM-JJ` en base, dans l'API et dans les tris — c'est le seul format qui se
trie correctement. `JJ/MM/AAAA` à l'écran et dans les exports, comme le
demandent les spécifications. Toutes les conversions passent par
`src/lib/date.ts`.

### Modèle de données

| Champ | Type | Remarque |
|---|---|---|
| `id` | `String` | cuid |
| `date` | `String` | ISO `AAAA-MM-JJ` |
| `personne` | `String` | `Momo`, `Sam` ou `Samy` |
| `joie` | `Int` | 1 → 10 |
| `biberon` | `Boolean` | facteur biberon |
| `planteVerte` | `Boolean` | colonne `plante_verte` |
| `notes` | `String?` | 500 caractères au plus |

L'unicité `(date, personne)` est volontaire : le tableau de bord compare des
moyennes quotidiennes, deux mesures le même jour pour la même personne
fausseraient les écarts.

### API

| Méthode | Route | Réponse |
|---|---|---|
| `GET` | `/api/entrees` | `{ entrees: Entree[] }` |
| `POST` | `/api/entrees` | `201` — crée ou remplace l'entrée du couple `(date, personne)` |
| `PATCH` | `/api/entrees/:id` | `200`, `404` si inconnue, `409` si le couple est déjà pris |
| `DELETE` | `/api/entrees/:id` | `204` |
| `GET` | `/api/version` | `{ version }` — empreinte du journal, interrogée toutes les 3 s |

Une charge utile invalide renvoie `422` avec le détail par champ ; le serveur
revalide tout, il ne fait pas confiance au formulaire.

## Choix d'interface

Les trois couleurs de profil ne sont pas choisies à l'œil : elles sont validées
sur la bande de clarté, le plancher de chroma, la séparation en vision
daltonienne et le contraste avec le fond — pour les deux thèmes séparément, le
sombre n'étant pas l'inverse du clair. Sur les courbes, la couleur est doublée
d'une forme de marqueur propre à chaque personne, pour que l'identité ne repose
jamais sur la seule teinte.

Un écart entre journées « avec » et « sans » n'est pas une preuve de causalité,
et les moyennes calculées sur peu de mesures sont signalées comme telles.
