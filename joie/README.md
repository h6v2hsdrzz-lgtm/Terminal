# Journal de joie — Momo, Sam & Samy

Application de suivi quotidien du niveau de joie de trois personnes, et mesure
de l'effet de deux déclencheurs : le **facteur biberon** et le **facteur plante
verte**.

Une saisie par personne et par jour, un tableau de bord qui compare les
journées « avec » et les journées « sans », et un journal exportable.

## Démarrage

Node 20 ou plus récent.

```bash
cd joie
npm install        # installe et génère le client Prisma
npm run db:setup   # crée la base SQLite (joie/prisma/dev.db)
npm run db:seed    # facultatif : six semaines de données de démonstration
npm run dev        # http://localhost:3000
```

`npm install` crée au passage un fichier `.env` à partir de `.env.example`.
Une seule variable y figure, le chemin de la base :

```
DATABASE_URL="file:./prisma/dev.db"
```

Pour repartir de zéro : supprimer `prisma/dev.db` et relancer `npm run db:setup`.

### Autres commandes

| Commande | Effet |
|---|---|
| `npm run build` / `npm start` | build de production, puis serveur |
| `npm test` | tests unitaires de l'analyse, des dates, de la validation et des exports |
| `npm run lint` | ESLint |
| `npm run db:migrate` | crée une migration après modification du schéma |
| `npm run db:studio` | Prisma Studio, pour inspecter la base |

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

## Architecture

```
joie/
├─ prisma/
│  ├─ schema.prisma        modèle Entree, contrainte d'unicité (date, personne)
│  ├─ migrations/          migrations SQL versionnées
│  └─ seed.ts              jeu de démonstration déterministe
├─ src/
│  ├─ app/
│  │  ├─ api/entrees/      GET, POST · PATCH, DELETE sur /:id
│  │  ├─ layout.tsx        métadonnées, thème appliqué avant la peinture
│  │  ├─ page.tsx          composant serveur : charge le journal, rend l'app
│  │  └─ globals.css       palette, thème sombre, curseur de joie
│  ├─ composants/          formulaire, indicateurs, graphiques, journal
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
**Lucide**, **Prisma 7** sur **SQLite**.

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
