# Où on en est

> Mis à jour à la fin de chaque tâche, jamais plus tard.
> À lire en premier, avant `CLAUDE.md`.

## Lot en cours

**LOT H — terminé.** Les quatre audits sont dans `AUDIT.md`. A à H sont faits.

## Prochaine action exacte

Il n'y a plus de lot. **Les lots F, G et H sont en ligne** depuis le
6 septembre — déploiement `dpl_H7Uy9qcyPHuQ17vzHhpvsRNBwVm3`, migrations
`jeux`, `cartes_paquet` et `lieu_position` appliquées par le `vercel-build`,
test de fumée et test des dix jeux passés contre la production.

Il reste quatre choses, listées à la fin d'`AUDIT.md` :

1. **Révoquer le jeton Vercel** gardé pour la durée de la session dans
   `~/.config/joie/vercel.token`.
2. **Effacer les données de démonstration** avant la mise en service.
3. **Vérifier à la main sur un vrai iPhone** ce qui ne s'automatise pas : HEIC,
   micro, caméra, inclinaison de « Devine qui je suis », coupure réseau en
   plein envoi, réinstallation de la PWA.
4. Un jour, sans urgence : borner le chargement de l'historique (521 Ko de
   JSON par écran aujourd'hui, quatre fois plus dans cinq ans), la file
   d'attente hors-ligne des envois, la notification d'ouverture des scellés.

### Ancienne note (lot B, fait)

**Lot B.** Il est déjà fait aux trois quarts (voir la correspondance en bas) :
il reste **B2** — la visionneuse. Ce qui manque, dans l'ordre de ce qui se voit
le plus : pincer pour zoomer, balayer vers le bas pour fermer, double-tap pour
réagir, enregistrer dans la pellicule. Et **B3**, prendre une photo depuis
l'app : c'est un attribut `capture` sur le champ de fichier, dix minutes.

Attention : `<input capture>` ouvre l'appareil photo mais ferme la pellicule.
Il faut donc DEUX entrées (« prendre une photo » / « choisir »), pas un
attribut ajouté au champ existant.

Le lot G (jeux) est décidé : **au moins dix**. Voir « Décisions prises ».

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
- **E** — les points : un module pur et testé, cinq niveaux, huit badges au
  lieu de vingt-trois (dont un secret qui ne dit ni son nom ni sa règle avant
  d'être gagné). **Deux écarts assumés au plan** : pas de points pour la série
  (A4 venait de retirer les compteurs de série — les remettre en points serait
  se contredire d'un lot à l'autre), et pas de classement hebdomadaire (à
  trois, un classement de points reste un classement de présence). Tout est
  dans `src/lib/points.ts` si la bande les veut quand même.
- **D** — la page Souvenirs dans le nouvel ordre : la galerie, les stats, les
  formes, ce jour-là, les scellés, le mur, la rétrospective en pied de page et
  repliée en une phrase. Les stats quittent leur onglet pour les souvenirs
  (`/stats` redirige), et le graphique des jours de la semaine est retiré.
- **C** — les scellés : quatre genres (mot, photo, vidéo, voix), l'aperçu
  flouté DANS SES OCTETS (32 px, fabriqué dans le navigateur), le décompte, le
  sablier d'une ligne, l'empilement du fil au-delà de deux, et une entrée
  depuis le check-in. Le contenu ne se sert pas avant la date, même à son
  auteur.
- **B2** — la visionneuse : pincer pour zoomer, glisser pour se déplacer,
  glisser vers le bas pour fermer, glisser sur le côté pour changer d'image,
  toucher deux fois pour poser un cœur, toucher une fois pour masquer
  l'habillage, préchargement des voisines, enregistrer/partager par la feuille
  du système. Elle quitte `Carrousel.tsx` pour son propre fichier.
- **B3** — prendre une photo depuis l'app, en DEUXIÈME entrée : sur iPhone,
  `capture` ouvre l'appareil et ferme la pellicule.
- **A2** — le fil devient la page d'ouverture, et il PORTE LE VOILE : les
  journées du jour sont muettes tant qu'on n'a pas posé la sienne, et la
  moyenne du jour ne s'affiche pas. Le check-in déménage à `/aujourdhui`,
  `/fil` redirige vers `/`. Une carte d'appel en tête, avec la figure du jour.
- **A1b** — « calme » devient « rire » dans l'interface et dans l'export. La
  colonne garde son nom : l'échelle est la même, et renommer une colonne pour
  un mot d'écran serait une migration risquée sans rien de visible.
- **Clôture du lot A** — CHANGELOG, README, suite complète au vert.
- **A5** — le profil montre « toi, en petit » : les dix derniers médias de la
  personne, et quatre traits tirés de ses journées (heure moyenne de check-in
  calculée sur un cercle, lieu le plus fréquent, part de vocaux, mot qui
  revient). Chaque trait se tait quand il n'y a pas de quoi le dire.
- **A3b** — photo de profil : choix, recadrage rond au doigt (glisser + zoom),
  compression en carré de 256 px, service par `/api/avatar/[membre]` réservé à
  la bande. Au passage, `Membre.modifieLe` entre dans l'empreinte de
  synchronisation — sans quoi ni un changement de nom ni un changement de photo
  n'arrivait chez les autres.
- **A3a** — on change son pseudo depuis le profil. Unicité dans la bande à la
  casse près, et reprendre son propre nom en changeant la casse passe. Le
  pseudo n'étant recopié nulle part, le passé change avec.

État : 190 tests unitaires, 66 de bout en bout (WebKit + grand écran), build
sans avertissement, `tsc --noEmit` propre.
En ligne : https://journal-de-joie-v2.vercel.app
Lot A déployé le 6 septembre, migrations `avatar_membre` et `marie_jane`
appliquées en production, test de fumée passé contre la production.

Le jeton Vercel est gardé sur la machine pour la durée de la session
(`~/.config/joie/vercel.token`, mode 600, hors du dépôt), pour pouvoir
redéployer à chaque lot sans le redemander. **À révoquer à la fin.**

La ligne de commande Vercel est autorisée par une règle de permission dans
`.claude/settings.local.json` à la racine du dépôt — fichier ignoré par git,
puisqu'il ne concerne que cette machine.

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
- **La figure du jour** est l'objet signature. Elle vit maintenant dans la
  carte d'appel en tête du fil — c'est la seule chose que ce journal a et que
  les autres n'ont pas, elle ne doit pas quitter la première page.
- **Les données d'avant la mise en service seront effacées** (réponse du
  5 septembre). C'est ce qui a permis de renommer « calme » en « rire » d'un
  bloc plutôt que de dater la bascule.
- **Les jeux : au moins dix** (réponse du 5 septembre). À faire au lot G, après
  B à F. Proposition à valider le moment venu : « Devine qui je suis » (G1, le
  jeu phare), « Je n'ai jamais », « Tu préfères », « Qui est le plus
  susceptible de », « Le jugement », « Menteur », « Le quiz de la bande »
  (questions tirées de vos propres données), « Devine qui a écrit ça », « Top
  3 », « Le plus rapide ». Dix, dont deux qui n'existent que chez vous.
  **Fait au lot G**, exactement cette liste.
- **Un seul mode de jeu : « un seul téléphone »** (écart au plan assumé). Le
  plan voulait aussi « chacun son téléphone », synchronisé par Supabase
  Realtime. Ici la synchronisation est un sondage de version, avec une à trois
  secondes de retard : invisible dans le fil, désastreux sur un vote simultané
  ou un duel de réflexe. Un mode qui donne l'impression que l'app rame vaut
  moins que pas de mode du tout. La colonne `mode` existe en base pour que le
  second n'impose pas de migration.
- **Les jeux ont leur propre plafond quotidien** (120 points). Argumenté dans
  `src/lib/jeux/recompense.ts` : le plan plafonnait tout « hors jeux » et
  laissait les jeux libres, ce qui faisait d'une soirée l'équivalent de sept
  journées parfaites.
- **Personne ne monte sur le podium quand personne n'a gagné.** « Je n'ai
  jamais » ne compte rien ; la première version donnait 40 points et une
  première place à toute la bande.
- **Les cartes de « Devine qui je suis » ne portent qu'un nom.** Faire deviner
  quelqu'un n'est pas le viser ; écrire une vanne sur lui dans l'application,
  si. L'humour noir demandé par le plan vit dans la partie, pas dans le fichier.
  Le seul paquet que la bande écrit est « Nos potes », et n'importe qui peut en
  retirer une carte sans se justifier.
- **Pas de Leaflet, pas de tuiles OpenStreetMap** (lot F, écart au plan
  assumé). Chaque tuile est une requête du téléphone vers un serveur tiers, et
  la suite des tuiles demandées dit où sont les souvenirs de la bande et
  lesquels on regarde. Pour une application dont la règle est que rien ne sort
  de la bande, c'est cher payé pour un fond de plan. À la place : une
  constellation SVG, zéro dépendance, zéro requête, et un test qui échoue si
  une requête sort vers un autre hôte.
- **La constellation ne projette pas linéairement.** Un lieu à trois cents
  kilomètres écrase cinq lieux distants de trois kilomètres — la première
  capture montrait une seule tache et cinq étiquettes empilées. Le placement
  mélange le linéaire (45 %) et le rang (55 %) : l'échappée reste loin, la
  grappe du quotidien s'ouvre. L'ordre des deux axes est conservé.

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
- **Une moyenne d'heures se prend sur un cercle.** 23 h 50 et 00 h 10 donnent
  minuit, pas midi — ce que donnerait la moyenne arithmétique.
- **`include` tire toutes les colonnes.** `chargerContexte` chargeait les octets
  de chaque avatar à chaque page avant qu'on sélectionne explicitement. Sur un
  champ `Bytes`, un `include` distrait coûte des méga-octets par navigation.
- **Une colonne qui change sans qu'aucune journée ne bouge est invisible aux
  autres** tant qu'elle n'est pas dans `versionBande`. Vrai pour les photos,
  les notes vocales, et maintenant le pseudo et l'avatar.
- **Un plafond « par jour » doit se calculer par jour, pas par ligne lue.** La
  première version d'`ardoise` plafonnait à dix réactions sur chaque entrée
  prise séparément : réagir à vingt-cinq journées le même soir rapportait
  vingt-cinq points, alors que c'est le geste que le plafond doit décourager.
- **Écrire `.value` sur un champ contrôlé ne prévient pas React.** Un test qui
  faisait ça croyait éprouver un refus de date : le formulaire partait avec la
  date d'origine et le test passait à côté. `fill()` passe par les événements
  natifs, que React écoute vraiment.
- **Le plein écran ne peut pas garder `scroll-snap`.** Le pincement exige
  `touch-action: none`, qui tue le défilement natif. C'est le seul endroit où
  réimplémenter le geste est justifié : il n'y a plus de page derrière, donc
  plus de geste système à préserver. Le carrousel du fil, lui, garde le natif.
- **Le double-tap ne peut pas être à la fois « zoomer » et « aimer ».** Le plan
  demandait les deux. Le pincement zoome déjà ; le double-tap aime.
- **Le fil n'avait aucun voile** avant A2 : il affichait tout en clair. En
  faire la page d'ouverture sans y porter le voile aurait suffi à casser la
  mécanique du produit.
- **Une entrée vidée n'est pas une entrée cachée.** `masquerEntree` met la joie
  à zéro ; sans passer `floute` à la carte, l'écran affichait un gros « 0 » et
  « 0,0 de moyenne » — pire qu'une fuite, une information fausse.
- **Renommer un libellé casse les tests qui le cherchent.** Le renommage A1a a
  cassé deux specs plus anciennes qui visaient « Ajouter une étiquette », et ça
  ne s'est vu qu'au passage de la suite COMPLÈTE — pas en lançant le seul
  fichier de la tâche en cours. Lancer tout avant de clore un lot.
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
5. Les jeux : lesquels, vraiment ? (liste proposée ci-dessus, en cours au lot G)

## Reste à faire, hors lots

- **C5, la notification d'ouverture.** L'ouverture est un événement à l'écran
  (le scellé rejoint les souvenirs le jour dit), mais il n'y a pas de
  notification poussée : elle demande des clés VAPID, un abonnement par
  appareil et un service d'envoi. À rouvrir si la bande la réclame.

## Correspondance avec les lots de `PLAN.md`

| Plan | État |
| --- | --- |
| A1 renommages | **fait** |
| A2 fil en accueil | **fait**, voile compris |
| A3 profil : photo et nom | **fait** |
| A4 retirer les 3 compteurs | **fait** |
| A5 album personnel + stats discrètes | **fait** |
| B1 pipeline d'upload | **fait**, sauf HEIC (question 4) |
| B2 visionneuse plein écran | **fait** |
| B3 prendre une photo depuis l'app | **fait** |
| B4 stockage | **fait autrement** : PostgreSQL, place occupée affichée. Pas d'abstraction R2 |
| B5 vidéos courtes | **fait** (8 s, pas 15 — voir question sur le poids) |
| C scellés | **fait** (sauf la notification d'ouverture — voir plus bas) |
| D souvenirs / stats / rétro | **fait** |
| E points et badges | **fait**, avec deux écarts assumés (voir plus haut) |
| F lieu | **fait**, sauf la carte à tuiles : constellation SVG à la place (voir « Décisions ») |
| G jeux | **fait** : moteur + 10 jeux. Un seul mode (« un téléphone »), voir « Décisions » |
| H audits | **fait** — voir `AUDIT.md` |
