# Journal de joie — le repaire de la bande

Version 2, en cours de construction. La v1 (`joie/`) reste en ligne pendant ce
temps et n'est pas touchée.

## L'application est complète

Cinq écrans, une base PostgreSQL, la synchronisation en temps réel, les photos,
les badges, les souvenirs, et l'installation sur l'écran d'accueil. Ce fichier
dit comment la faire tourner, ce qui a été décidé et pourquoi.

**Ce qu'on en fait, un soir :** on ouvre, on fait glisser un curseur de 1 à 10,
on coche éventuellement ce qui a marqué la journée, on écrit deux lignes si on
veut. Dix secondes. Les journées des autres, floutées jusque-là, se dévoilent
d'un coup.

## Démarrer

```bash
cd bande
npm install
cp .env.example .env          # puis renseigner DATABASE_URL et SECRET_SESSION
npx prisma migrate dev        # crée les tables
npm run db:seed               # une bande de démonstration, 3 profils × 400 jours
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

## Les écrans

| Écran | Ce qu'on y fait |
| --- | --- |
| **Aujourd'hui** | Poser sa journée, la corriger, y mettre une photo. Voir celles des autres — floutées tant qu'on n'a pas posé la sienne. Réagir, commenter. |
| **Le fil** | Toutes les journées de la bande, groupées par jour, avec la moyenne du jour. |
| **Les stats** | Courbe lissée sur trente jours, calendrier façon damier, effet des déclencheurs, écarts par jour de semaine, synchronicité entre deux personnes. |
| **Les souvenirs** | Rétrospective d'un mois avec image partageable, « ce jour-là », capsules temporelles, mur des moments. |
| **Profil** | Séries, badges, classement d'assiduité de la semaine, calendrier personnel, réglages de la bande, export, départ. |

## Les décisions

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

**Le classement porte sur l'assiduité, jamais sur le bonheur.** C'est la
décision la plus structurante du produit. Classer sur la joie ferait perdre
toutes les semaines à quelqu'un qui traverse un mauvais mois, et récompenserait
de dire qu'on va bien. On compte les journées posées — la seule chose que chacun
contrôle. Aucun des vingt-et-un badges ne récompense d'aller bien non plus : un
test vérifie qu'une bande qui note toujours 3 en obtient exactement autant
qu'une bande qui note toujours 9. « Même les jours creux » se gagne en posant une
journée à 1.

**Le temps réel passe par un sondage, pas par une connexion permanente.** Une
empreinte de l'état de la bande — six agrégats — est demandée toutes les trois
secondes, et le rendu est redemandé quand elle change. La journée de l'autre
apparaît en deux à trois secondes. Rien à reconnecter après une mise en veille,
rien à maintenir côté serveur, et une fonction sans état peut le servir. On ne
sonde pas un onglet caché.

**Les photos vivent dans la base**, réduites à 1200 pixels dans le navigateur
avant l'envoi : une photo de téléphone de 2,3 Mo arrive en 15 ko. Un stockage
d'objets serait le choix normal, mais il demanderait un compte de plus. Le jour
où ça déborde, `depot.ts` est le seul fichier à rouvrir.

**Le texte d'une capsule non ouverte ne quitte pas le serveur.** Le cacher côté
client reviendrait à l'envoyer et à demander poliment de ne pas regarder. Ce
n'est pas du chiffrement pour autant : le texte est lisible en base par qui
l'administre. C'est une convention entre amis, et il vaut mieux le dire que le
laisser croire.

**On peut tout exporter, et on peut partir.** L'export vient avant le départ, et
pas seulement dans l'ordre de la page : une application dont les données ne
sortent pas est une application qui retient. Le départ demande de recopier le
nom de la bande — un bouton se clique par erreur, un nom ne se recopie pas par
accident.

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

## Hors ligne

L'application s'installe sur l'écran d'accueil (manifeste, icônes, icône
masquable pour Android, icône dédiée pour iOS) et reste ouvrable sans réseau.

Le service worker suit trois règles, dans cet ordre : les pages passent par le
réseau d'abord — une bande veut voir la journée qu'on vient de poser, pas une
copie d'hier ; les ressources versionnées passent par le cache d'abord, leur
adresse changeant à chaque déploiement ; le reste — routes d'API, photos,
synchronisation — n'est jamais mis en cache, servir une photo périmée causant
plus de dégâts qu'une erreur franche.

Une journée écrite sans réseau est gardée sur l'appareil et repart toute seule
au retour de la connexion. C'est la seule chose mise en file d'attente : le
check-in est ce qu'on fait vraiment dans le métro.

## Ce qui n'y est pas

Pas de notifications poussées : elles demandent des clés VAPID, un abonnement
par appareil et un service d'envoi, pour un rituel qui tient déjà dans une
habitude du soir. Pas de fil infini — douze journées à la fois. Le mur des
souvenirs se limite à douze moments. Les capsules ne sont pas chiffrées, comme
dit plus haut.

## Tests

```bash
npm test                   # 108 tests sur la logique pure
```

Ils portent sur le calcul — dates, analyses, badges, souvenirs, codes,
initiales — et pas sur la base, qui est éprouvée par des parcours au navigateur.
Un test qui monte une base pour vérifier une moyenne coûte mille fois son prix.

Ce qu'ils protègent, entre autres : la bascule de 4 h du matin, les passages à
l'heure d'été et d'hiver, le refus de qualifier de net un écart noyé dans le
bruit, la semaine qui commence au lundi, la corrélation qui rend `null` plutôt
qu'une division par zéro, les mois civils complets et février bissextile, les
initiales qui ne rendent jamais deux jumeaux.

## Structure

```
prisma/
├─ schema.prisma  sept tables, toutes préfixées bande_
└─ seed.ts        la bande de démonstration, déterministe
scripts/
└─ valider-palette.mjs   les contrôles data-viz sur les jetons livrés
public/
├─ sw.js          le service worker
└─ icone-*.png    les icônes, engendrées depuis le visage de la joie
src/
├─ app/
│  ├─ (entree)/   bienvenue, créer, rejoindre, reprendre — sans navigation
│  ├─ (repaire)/  les cinq écrans, derrière la garde de session
│  ├─ api/        photo, version (synchronisation), export
│  ├─ hors-ligne/ la coquille servie sans réseau
│  └─ manifest.ts le manifeste d'installation
├─ composants/    visage, avatar, carte, curseur, navigation, graphiques
└─ lib/
   ├─ db.ts       le client Prisma, un seul, à petit pool
   ├─ session.ts  le cookie signé, et le code de reprise le temps de le noter
   ├─ codes.ts    l'alphabet sans caractères ambigus, et le hachage
   ├─ depot.ts    tout ce qui touche la base ; rend les types du domaine
   ├─ actions.ts  les actions serveur, qui rendent un état au lieu de lever
   ├─ attente.ts  la journée écrite hors ligne, gardée puis renvoyée
   ├─ couleurs.ts teintes de profil et rampe de joie — jamais de code en dur
   ├─ dates.ts    le jour de la bande, et sa bascule à 4 h
   ├─ analyse.ts  moyennes, effets, corrélation — avec leurs garde-fous
   ├─ badges.ts   les vingt-et-un badges et le classement d'assiduité
   └─ souvenirs.ts « ce jour-là », le mur, la rétrospective
```

## Commandes

```bash
npm run dev                # le serveur de développement
npm run build              # la compilation de production
npm run lint               # ESLint
npm run db:migrer          # appliquer une migration
npm run db:seed            # rejouer la bande de démonstration
npm run db:studio          # explorer la base
npm test                   # la suite de tests
npm run verifier:palette   # revérifier les couleurs de profil
```

## Mettre en ligne

L'application tourne partout où tourne Next.js. Sur Vercel :

1. **La base.** Créer une base PostgreSQL (Neon, Supabase, Railway…), récupérer
   l'adresse *avec pool* et l'adresse *directe*.
2. **Les variables**, dans les réglages du projet : `DATABASE_URL` (avec pool),
   `MIGRATE_DATABASE_URL` (directe) et `SECRET_SESSION` (une chaîne aléatoire —
   la commande est dans le tableau plus haut).
3. **Les migrations pendant la compilation.** Ajouter à `package.json` :
   `"vercel-build": "prisma migrate deploy && next build"`.
4. **Retirer la protection de déploiement** si elle est active, sinon vos amis
   devront se créer un compte chez l'hébergeur pour ouvrir le lien.

Ensuite, il suffit d'envoyer l'adresse et le code d'invitation à six caractères.

## Inviter quelqu'un

Depuis **Profil → Réglages de la bande**, le bouton *Copier* met dans le
presse-papiers l'adresse et le code, prêts à coller dans un message. La personne
ouvre le lien, tape le code et son prénom, et elle y est — pas de compte, pas de
mot de passe, pas d'email.

Sur iPhone, *Partager → Sur l'écran d'accueil* installe l'application ; sur
Android, le navigateur le propose de lui-même.
