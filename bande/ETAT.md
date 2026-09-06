# Où on en est

> Mis à jour à la fin de chaque tâche, jamais plus tard.
> À lire en premier, avant `CLAUDE.md`.

## Lot en cours

**LOT A.** Feu vert donné. A1a fait. Les questions 1, 2, 4 et 5 restent sans
réponse : on avance sur ce qui n'en dépend pas.

## Prochaine action exacte

**A5 — l'album personnel.** Dans `src/app/(repaire)/profil/page.tsx`, sous
l'en-tête : les dix derniers médias de la personne (`mediasDeLaBande` filtré sur
`profil`, ou une requête dédiée si le filtre coûte trop), en grille de vignettes,
ouvrables avec la `Visionneuse` exportée par `Carrousel.tsx`. En dessous, trois
ou quatre stats discrètes — heure moyenne de check-in, lieu le plus fréquent,
proportion de journées avec vocal, mot le plus utilisé. Petit texte, ton léger,
surtout pas un tableau de bord : on vient d'en retirer un en A4.

Ensuite, lot A terminé : captures, CHANGELOG, mise en ligne.

A1b (calme → rire) et A2 (fil en accueil) attendent les réponses 1 et 2.

## Terminé

Le travail d'avant `PLAN.md` était découpé en « lots » qui ne sont **pas** ceux
du plan. Correspondance à la fin de ce fichier.

- Lot 0 — fondations, identité sans compte, cinq écrans, PWA, hors-ligne,
  Playwright sur WebKit/iPhone, palette validée en clair et en sombre.
- Lot 1 — la figure du jour (le concept), titre, étiquettes, curseurs
  énergie/calme, multi-photos, note vocale de 30 s. En ligne.
- Lot 2 — la vidéo (réencodage WebCodecs dans le navigateur), les vignettes,
  la galerie, les légendes, la place occupée. En ligne.
- **A1a** — renommages : « Plante verte » → **Marie Jane** (migration de
  données : la ligne garde son identifiant, les 496 journées qui la portaient
  restent liées), « ce qui a fait la journée » → **l'anecdote**, « étiquettes »
  → **Lieu** dans l'interface et l'export.
- **A4** — les trois compteurs du profil (« jours d'affilée », « ton record »,
  « journées posées ») sont retirés.
- **A3b** — photo de profil : choix, recadrage rond au doigt (glisser + zoom),
  compression en carré de 256 px, service par `/api/avatar/[membre]` réservé à
  la bande. Au passage, `Membre.modifieLe` entre dans l'empreinte de
  synchronisation — sans quoi ni un changement de nom ni un changement de photo
  n'arrivait chez les autres.
- **A3a** — on change son pseudo depuis le profil. Unicité dans la bande à la
  casse près, et reprendre son propre nom en changeant la casse passe. Le
  pseudo n'étant recopié nulle part, le passé change avec.

État : 174 tests unitaires, 43 de bout en bout (WebKit + grand écran), build
sans avertissement, `tsc --noEmit` propre.
En ligne : https://journal-de-joie-v2.vercel.app

## Décisions prises, et pourquoi

- **Pas de Supabase.** Le repo tourne sur Prisma + Neon depuis le début.
  Migrer réécrirait l'accès aux données, l'identité et le déploiement d'une
  application qui marche, sans rien de visible en échange. Les garanties du
  plan sont tenues autrement — voir le tableau de correspondance dans
  `CLAUDE.md`.
- **Les octets dans PostgreSQL**, pas dans un stockage objet. Zéro service à
  créer, zéro clé à gérer. La contrepartie est le plafond de 0,5 Go de Neon :
  c'est pour ça que les vidéos sont réencodées et que la place occupée est
  affichée dans les réglages.
- **Le modèle `Media` est mappé sur la table `bande_photos`.** Renommer la
  table via Prisma produirait un `DROP` + `CREATE`, donc la perte des photos.
- **La figure du jour** est l'objet signature. Toute refonte de l'accueil doit
  lui garder une place — c'est la seule chose que ce journal a et que les
  autres n'ont pas.

## Pièges déjà payés (ne pas les redécouvrir)

- Le WebKit de Playwright **n'a pas `MediaRecorder`** : micro, caméra et
  sélecteur de fichiers iOS ne s'y testent pas. Il a WebCodecs au complet.
- Un `<video>` **hors du document** n'est peint par personne : le transcodage
  prend ses images en déplaçant le curseur, pas en lisant.
- WebKit refuse un cookie `Secure` sur `http://localhost` : la suite locale
  vise `npm run dev`. Chaque test vérifie d'abord qu'il est connecté — six
  captures ont déjà passé au vert en photographiant l'écran d'accueil.
- Un PNG écrit à la main peut passer sur WebKit et être refusé par Chromium.
  Les fixtures viennent de `prisma/image-factice.ts`.
- `prisma migrate dev --create-only`, **relire le SQL**, puis appliquer.
- Un test qui dépend d'un classement (le mur des souvenirs) passe une fois sur
  deux : c'est le peuplement qui doit garantir la donnée, pas la chance.
- **Renommer un libellé ne suffit pas** : les déclencheurs par défaut sont
  copiés en base à la création de la bande. Sans migration `UPDATE`, la
  production aurait gardé l'ancien nom. Et un `DELETE` + `INSERT` aurait emporté
  la table de liaison par cascade — des mois de données pour un mot.
- **`include` tire toutes les colonnes.** `chargerContexte` chargeait les octets
  de chaque avatar à chaque page avant qu'on sélectionne explicitement. Sur un
  champ `Bytes`, un `include` distrait coûte des méga-octets par navigation.
- **Une colonne qui change sans qu'aucune journée ne bouge est invisible aux
  autres** tant qu'elle n'est pas dans `versionBande`. Vrai pour les photos,
  les notes vocales, et maintenant le pseudo et l'avatar.
- Next pose son propre `role="alert"` (l'annonceur de route) : un test qui
  cherche un message d'erreur par ce rôle doit prendre `.first()`.
- `plusLongueSerie` et `serieEnCours` (`src/lib/badges.ts`) ne servent plus à
  aucun écran depuis A4. Elles restent, avec leurs tests : E4 refond les badges
  et tranchera. Ne pas les supprimer « au passage ».
- **Le stockage garde ses anciens noms** quand l'interface change : la table
  s'appelle `bande_photos` (elle porte les vidéos), le modèle des lieux
  s'appelle `Etiquette`. Renommer pour un mot d'interface, c'est une migration
  risquée sans rien de visible.

## Questions en attente

1. « Rire » remplace « calme » : que fait-on des journées déjà notées ?
2. Le fil en page d'accueil : où va la figure du jour ?
3. A4 retire les compteurs de série, E1 donne des points par jour de série.
4. HEIC : est-ce un vrai problème sur vos téléphones ?
5. Les jeux : lesquels, vraiment ?

## Correspondance avec les lots de `PLAN.md`

| Plan | État |
| --- | --- |
| A1 renommages | **A1a fait** · A1b (calme → rire) en attente de la Q1 |
| A2 fil en accueil | à faire — dépend de la question 2 |
| A3 profil : photo et nom | **fait** |
| A4 retirer les 3 compteurs | **fait** |
| A5 album personnel + stats discrètes | à faire |
| B1 pipeline d'upload | **fait**, sauf HEIC (question 4) |
| B2 visionneuse plein écran | **à moitié** : plein écran, défilement, légendes, position. Manquent le zoom au pincement, le balayage vers le bas, le double-tap pour réagir, l'enregistrement dans la pellicule |
| B3 prendre une photo depuis l'app | à faire (un attribut, 10 min) |
| B4 stockage | **fait autrement** : PostgreSQL, place occupée affichée. Pas d'abstraction R2 |
| B5 vidéos courtes | **fait** (8 s, pas 15 — voir question sur le poids) |
| C scellés | **à moitié** : capsules texte seul, pas de sablier ni d'empilement |
| D souvenirs / stats / rétro | ordre à revoir, stats à resserrer |
| E points et badges | à faire — 23 badges aujourd'hui, le plan en veut 8 |
| F lieu | à faire — les « étiquettes » existent et deviendront « Lieu » en A1 |
| G jeux | rien. C'est un projet en soi |
| H audits | à la fin |
