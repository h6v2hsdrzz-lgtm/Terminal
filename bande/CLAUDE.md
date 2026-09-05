@AGENTS.md

# Journal de Joie — repères d'architecture

`PLAN.md` est la source de vérité du projet. `ETAT.md` dit où on en est.
Ce fichier-ci évite de relire tout le repo à chaque session.

## La pile, et ce qu'elle n'est pas

**Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 ·
Motion · Prisma 7 · PostgreSQL (Neon) · déploiement Vercel.**

`PLAN.md` a été écrit en supposant **Supabase**. Ce n'est pas la pile de ce
repo, et les termes du plan se traduisent ainsi :

| Le plan dit | Ici, c'est |
| --- | --- |
| `supabase/migrations/` | `prisma/migrations/`, additives, relues avant d'être appliquées |
| RLS sur chaque table | autorisation côté serveur : **toute** lecture est filtrée par `groupeId`, et les routes de médias vérifient l'appartenance à la bande |
| Supabase Storage, buckets privés | les octets vivent dans PostgreSQL, servis par des routes qui exigent une session |
| Supabase Realtime | sondage d'une empreinte de version (`versionBande`), qui agrège comptes et derniers horodatages |

## Où sont les choses

```
prisma/schema.prisma     10 modèles, tous préfixés bande_
prisma/seed.ts           4 profils × 400 jours, images et sons engendrés
src/app/(entree)/        bienvenue, créer, rejoindre, reprendre
src/app/(repaire)/       page.tsx (Aujourd'hui), fil, stats, souvenirs, galerie, profil, reglages
src/app/api/             photo/[media], vignette/[media], audio/[entree], export, sante, version
src/composants/          un fichier par composant, noms français
src/lib/                 depot.ts (tout PostgreSQL), actions.ts (actions serveur), et la logique pure
e2e/                     Playwright : captures, lot1, video, production
```

**La règle du dépôt :** rien d'autre que `src/lib/depot.ts` ne parle à Prisma.
Il rend les types de `src/lib/types.ts`, jamais les lignes Prisma.

**La règle des tests :** ce qui se calcule vit dans un module pur et se teste
(`figure`, `media`, `onde`, `etiquettes`, `csv`, `analyse`, `souvenirs`,
`badges`, `dates`). Le reste se vérifie dans Playwright, sur WebKit.

## Le schéma, en une phrase chacun

`Groupe` la bande · `Membre` une personne (code de reprise en scrypt) ·
`Entree` une journée (joie, titre, note, énergie, **calme**, déclencheurs) ·
`Media` photo **ou** vidéo (table `bande_photos`, voir ci-dessous) ·
`Audio` la note vocale · `Etiquette` + `EntreeEtiquette` · `Declencheur` +
`EntreeDeclencheur` · `Reaction` · `Commentaire` · `Capsule` (scellé, texte seul).

**Le modèle `Media` est mappé sur la table `bande_photos`.** Prisma ne sait pas
reconnaître un renommage de table : il produirait un `DROP` suivi d'un `CREATE`,
donc la perte des photos en ligne. Un nom de table daté coûte moins cher.

## Commandes

```bash
npm run dev            # http://localhost:3000
npm test               # Vitest, logique pure
npx playwright test --project=iphone   # WebKit, gabarit iPhone 15
npm run db:seed        # bande de démonstration + .codes-demo.txt
npx prisma migrate dev --create-only   # écrire la migration, la RELIRE, puis l'appliquer
```

## Ce qu'il ne faut pas réapprendre à ses dépens

- **Le WebKit de Playwright n'est pas Safari iOS.** Il n'a pas `MediaRecorder`.
  Il a WebCodecs. Micro, caméra et sélecteur de fichiers iOS ne s'y testent pas.
- **WebKit refuse un cookie `Secure` sur `http://localhost`** : la suite locale
  vise `npm run dev`, pas `npm run start`, et chaque test vérifie sa session.
- **Un `<video>` hors du document n'est peint par personne** — c'est pour ça que
  le transcodage prend ses images en déplaçant le curseur, pas en lisant.
- **Migrations :** `prisma migrate dev --create-only`, lire le SQL, puis
  appliquer. Un renommage de champ Prisma = un `DROP` silencieux.
- **Champs de saisie à 16 px** (classe `champ-saisie`), cibles tactiles 44 px
  (`cible-tactile`), `100dvh` jamais `100vh`, zones sûres sur la barre du bas.
- Le voile ne floute pas : le serveur **vide** les entrées (`masquerEntree`).
  Tout ce qui descend dans un composant client est lisible.
