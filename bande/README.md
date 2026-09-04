# Journal de joie — le repaire de la bande

Version 2, en cours de construction. La v1 (`joie/`) reste en ligne pendant ce
temps et n'est pas touchée.

## État : jalon 2 livré — la base, les comptes, les vraies données

Les quatre écrans lisent maintenant une base PostgreSQL. On crée une bande, on
la rejoint avec un code, on pose sa journée, et les journées des autres se
dévoilent quand on a posé la sienne.

## Démarrer

```bash
cd bande
npm install
cp .env.example .env          # puis renseigner DATABASE_URL et SECRET_SESSION
npx prisma migrate dev        # crée les tables
npm run db:seed               # une bande de démonstration, 3 profils × 90 jours
npm run dev                   # http://localhost:3000
```

Le script de peuplement affiche à la fin les **codes de reprise** des trois
profils de démonstration : ils servent à se connecter en tant que Momo, Sam ou
Samy depuis `/reprendre`. Le code d'invitation de la bande est `FR9M4G`.

### Une base PostgreSQL en local

N'importe quelle instance fait l'affaire. Avec Docker :

```bash
docker run --name bande-pg -e POSTGRES_PASSWORD=joie -e POSTGRES_USER=joie \
  -e POSTGRES_DB=bande -p 5433:5432 -d postgres:16
```

L'adresse correspondante est celle du `.env.example`.

## Variables d'environnement

Aucun secret n'est versionné : `.env` est ignoré, `.env.example` documente ce
qu'il faut y mettre.

| Variable | Obligatoire | À quoi ça sert |
| --- | --- | --- |
| `DATABASE_URL` | oui | La base. En ligne, l'adresse **avec pool** (chez Neon, l'hôte porte `-pooler`). |
| `MIGRATE_DATABASE_URL` | seulement en ligne | L'adresse **directe**, pour les migrations uniquement. Prisma pose un verrou de session avant de migrer, qu'un pool en mode transaction ne sait pas tenir : sans elle, la migration expire. Inutile en local, où l'adresse ci-dessus est déjà directe. |
| `SECRET_SESSION` | oui | Signe le cookie d'identité. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. La changer déconnecte tout le monde. |

## Les décisions prises au jalon 2

**Pas de compte, pas d'email, pas de mot de passe.** On rejoint une bande avec
un code de six caractères qu'un ami dicte au téléphone, et le navigateur garde
ensuite un cookie signé. Il n'y a donc aucune donnée personnelle à perdre — et
aucun formulaire d'inscription entre l'envie d'essayer et le premier check-in.

**Le code de reprise est coupé en deux.** Sa première moitié est publique et
indexée : elle seule permet de retrouver la ligne sans balayer la table. La
seconde est un secret, gardé uniquement sous forme d'empreinte scrypt — c'est
un mot de passe, il en mérite le traitement. Il est montré une fois, et jamais
par l'URL : une adresse se retrouve dans l'historique du navigateur, dans les
journaux du serveur et dans l'en-tête `Referer` de la requête suivante. Il
transite par un cookie de cinq minutes.

**Sept personnes par bande, pas dix.** Le plafond vient de la palette : sept
couleurs de profil passent les contrôles calculables (bande de clarté, plancher
de chroma, écart sous protanopie et deutéranopie, contraste sur le fond) sur
**toutes** les paires et dans **les deux thèmes**. À huit, la bande de clarté du
thème sombre est trop étroite pour garder un rouge et un vert séparés pour un
œil daltonien. Élargir la bande demandera un second encodage — un trait
pointillé sur les courbes — plutôt qu'une huitième teinte tirée à l'œil.
`npm run verifier:palette` refait la démonstration sur les jetons livrés.

**Une mesure par personne et par jour**, garantie par une contrainte d'unicité
en base et non par l'interface. Reposter le même jour remplace ; c'est ce qui
rend les moyennes journalières comparables.

**Les statistiques disent quand elles ne savent pas.** Un effet de déclencheur
n'affiche un chiffre que si l'écart dépasse deux fois son incertitude ; sinon
l'écran dit « rien de net ». Sans ce garde-fou, un « +0,2 » né du hasard
s'affiche avec le même aplomb qu'un « +1,3 » réel.

**Le graphique de la semaine montre des écarts, pas des valeurs.** Toutes les
moyennes tiennent entre 6 et 8 : sur une échelle qui part de 1, les sept barres
sortaient à la même hauteur, et le lundi ressemblait trait pour trait au samedi
sous une phrase qui affirmait le contraire.

**Les initiales des avatars sont calculées pour la bande entière.** Prises
isolément, « Sam » et « Samy » donnent toutes deux « SA » : deux avatars que
seule la couleur sépare, alors que l'avatar est justement le second encodage,
celui qui reste quand la couleur ne suffit pas. Ils donnent « SM » et « SY ».

**Les tables portent le préfixe `bande_`.** Elles partagent la base hébergée
avec la v1, qui garde les siennes. Un préfixe plutôt qu'un schéma PostgreSQL :
le déploiement reste une seule variable à coller, sans rien créer à la main
dans une console.

## Les décisions du jalon 1, toujours valables

**La journée ferme à 4 h du matin, pas à minuit.** Un check-in à 1 h appartient
encore à la soirée qu'on vient de vivre.

**Pas de rouge, jamais.** L'échelle de joie n'est pas un feu tricolore : une
seule famille chaude, du discret au rayonnant. Une journée à 2 s'affiche avec
la même dignité qu'une journée à 9, simplement plus calme.

**Inter est servie par l'application**, pas par un CDN : la typographie ne
dépend d'aucun tiers joignable, et rien ne fuite vers Google.

**Le visage n'est pas un emoji** mais un tracé dont la bouche s'incurve avec la
note.

## Ce que le jalon 2 ne fait pas encore

Réactions et commentaires sont **affichés mais inertes** : on voit ceux du
script de peuplement, on ne peut pas encore en poser. Pas de photos, pas de
temps réel, pas de notifications, pas de mode hors-ligne. Les badges sont au
nombre de six et se déduisent des journées posées ; la collection complète est
prévue plus tard. Les réglages de la bande (nom, déclencheurs, dévoilement)
existent en base mais n'ont pas encore d'écran.

## Structure

```
prisma/
├─ schema.prisma  sept tables, toutes préfixées bande_
└─ seed.ts        la bande de démonstration, déterministe
scripts/
└─ valider-palette.mjs   les contrôles data-viz sur les jetons livrés
src/
├─ app/
│  ├─ (entree)/   bienvenue, créer, rejoindre, reprendre — sans barre d'onglets
│  └─ (repaire)/  les quatre écrans, derrière la garde de session
├─ composants/    visage, avatar, carte, curseur, barre d'onglets, graphiques
└─ lib/
   ├─ db.ts       le client Prisma, un seul, à petit pool
   ├─ session.ts  le cookie signé, et le code de reprise le temps de le noter
   ├─ codes.ts    l'alphabet sans caractères ambigus, et le hachage
   ├─ depot.ts    tout ce qui touche la base ; rend les types du domaine
   ├─ actions.ts  les actions serveur, qui rendent un état au lieu de lever
   ├─ couleurs.ts teintes de profil et rampe de joie — jamais de code en dur
   ├─ dates.ts    le jour de la bande, et sa bascule à 4 h
   ├─ analyse.ts  moyennes, effets, corrélation — avec leurs garde-fous
   └─ badges.ts   les six badges, déduits des journées
```

## Commandes

```bash
npm run dev                # le serveur de développement
npm run build              # la compilation de production
npm run lint               # ESLint
npm run db:migrer          # appliquer une migration
npm run db:seed            # rejouer la bande de démonstration
npm run db:studio          # explorer la base
npm run verifier:palette   # revérifier les couleurs de profil
```
