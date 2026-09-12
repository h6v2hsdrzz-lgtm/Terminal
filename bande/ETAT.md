# Où on en est

> Mis à jour à la fin de chaque tâche, jamais plus tard.
> À lire en premier, avant `CLAUDE.md`.

## Lot en cours

**Vague 2 : tous les lots sont terminés, J à R.** O2 (le registre) est passé avant
le lot L parce que c'est le reproche explicite de la bande sur la livraison
précédente — « c'est vraiment x100, vas-y super fort ». Les chiffres du plan
sont tenus et verrouillés par un test :
`src/lib/jeux/contenu/contenu.test.ts`. `PLAN.md` porte maintenant la vague 2
(lots J à R) ; `PLAN-vague-1.md` garde la première, à laquelle `AUDIT.md`
renvoie.

**Le lot N est fait : les dix jeux se jouent sur trois téléphones.** L'état vit
sur le serveur, un flux SSE le descend, et l'écran affiché dépend du rôle du
joueur dans la manche. Trois archétypes couvrent les dix jeux — vote, tour,
réflexe — et les règles restent dans des recettes (`src/lib/jeux/recettes.ts`)
appliquées par le navigateur de l'hôte. Neuf tests de bout en bout à **deux
contextes de navigateur**, c'est-à-dire deux téléphones : les quatre formes
d'écran jouées pour de vrai, et la reprise de main quand l'hôte ferme son
application.

**Le lot O est fait : treize jeux, et des photos sur les cartes.** 237 cartes de
« Devine qui je suis » sur 494 ont une image de Wikipédia, servie par nos
routes — le téléphone de la bande ne parle jamais à Wikimedia. « Le plus
rapide » a son décompte 3-2-1, son délai imprévisible, ses millisecondes en
gros, son mode duel et son format en cinq manches. Et trois jeux de plus :
« Le mot de passe » (qui tourne en arrière-plan des autres), « La théorie du
complot » et « Le tribunal des idées », tous deux enregistrés, gardés dans la
nouvelle table `bande_paroles` et réécoutables dans les souvenirs.

**Le lot P est fait : deux graphiques, et les règles communes sur les trois.**
L'évolution du classement général remplace rien (elle s'ajoute sous « Tes
points ») ; les déclencheurs dans le temps remplacent « la semaine », comme le
plan le demandait. Les trois graphiques de l'application rendent maintenant leur
valeur au TAP, tiennent sous deux cents pixels et se lisent en clair comme en
sombre.

**Le lot Q est entier.**

- **Q1 · les réglages** — notifications par type, thème, confidentialité,
  stockage, gestion de la bande, déconnexion. Les notifications poussées sont
  **écrites à la main** : RFC 8291 (ECDH P-256 + HKDF + AES-128-GCM), RFC 8188
  (`aes128gcm`) et RFC 8292 (jeton VAPID ES256), avec `node:crypto` et aucune
  dépendance de plus. Les tests vérifient les six intermédiaires publiés par le
  RFC 8291, puis déchiffrent pour de bon. Six types réglables, tout allumé sauf
  les réactions.
- **Q2 · rien n'échoue en silence** — un bandeau unique dit le hors-ligne, le
  retour, et les gestes qui n'ont pas abouti, avec un bouton qui refait ce qui a
  raté. Sept appels jetaient l'erreur que le serveur leur rendait, dont le
  **retrait d'une journée**.
- **Q3 · liens profonds** — `/jour/2026-09-11` existe, les notifications y
  mènent, le service worker sait y emmener sans ouvrir un deuxième onglet.
- **Q4 · sauvegarde et restauration** — un vrai ZIP, écrit à la main, avec les
  photos et les vocaux dedans ; et l'import qui le remet en place sans rien
  écraser.
- **Q5 · la recherche** — accents et casse ignorés, plusieurs mots, surlignage,
  et **le voile s'y applique** (il exclut, il ne vide pas).
- **Q6 · les performances** — le décalage de mise en page mesuré sous 0,1 sur
  quatre écrans, chaque image qui annonce sa taille, la galerie qui ne dépose
  plus tout d'un coup, et un build de production sans un seul avertissement.
  Lighthouse lui-même reste à lancer à la main : voir plus bas.
- **Q7 · les nouveautés** — cinq écrans à la première ouverture après une mise
  à jour, revoyables depuis les réglages.
- **Les deux dettes** — le réveil du matin (`/api/reveil`, une fois par jour)
  prévient d'un scellé qui s'ouvre et renvoie son plaidoyer à l'auteur.

**Le lot R est fait : les trois audits.**

- **Audit 1, fonctionnel** (`AUDIT-vague-2.md`) — les quarante-sept points de
  `PLAN.md` repris un par un : 44 faits, 3 partiels, 0 pas fait. Chaque
  affirmation vérifiée dans le code, pas recopiée d'ici.
- **Audit 2, visuel** (`AUDIT-vague-2-visuel.md`) — huit familles de captures,
  clair et sombre, plein et vide. Quatre défauts trouvés **en regardant** : une
  bande blanche en travers de la recherche, « Choose File » en anglais,
  « Restaurer » rangé derrière « Quitter la bande », et aucun état de chargement
  nulle part.
- **Audit 3, parcours réel** (`AUDIT-vague-2-parcours.md`, `e2e/audit3.spec.ts`)
  — trois téléphones, des parties complètes. Deux défauts que deux téléphones ne
  pouvaient pas montrer : **corriger sa journée ne changeait rien chez les
  autres**, et les deux souffleurs de « Devine qui je suis » n'avaient pas de
  boutons.

## Prochaine action exacte

**La vague 2 est terminée côté code.** Ce qui reste ne se fait pas depuis ici :

1. ~~Poser les variables chez Vercel~~ — **fait le 12 septembre.** Les quatre
   (`CRON_SECRET`, `VAPID_PUBLIQUE`, `VAPID_PRIVEE`, `VAPID_CONTACT`) sont
   posées en `production` et `preview`, les deux secrètes chiffrées. Elles se
   relisent avec `vercel env pull` ; elles ne sont écrites **nulle part** dans
   le dépôt. Vérifié depuis l'extérieur : `/api/reveil` refuse sans le secret
   (401) et rend `{"scelles":0,"paroles":0}` avec. Le cron est enregistré sur
   le déploiement (`0 7 * * *`), une fois par jour — ce que le palier gratuit
   autorise.

   `VAPID_CONTACT` est l'adresse du site et non un `mailto:` : le RFC 8292
   accepte les deux, et je n'allais pas poser l'adresse de courriel de
   quelqu'un chez Apple et Google sans qu'il me le demande. À changer en
   `mailto:` si vous voulez être joignables par un opérateur de pousse.
2. **Lighthouse mobile ≥ 90**, à la main, contre l'adresse en ligne. Pas
   mesurable ici : Lighthouse n'est pas installable, et il jugerait le serveur
   de développement.
3. **L'essai à la main sur un vrai iPhone.** Ce WebKit n'a ni `MediaRecorder`,
   ni `PushManager`, ni `Notification`, et le sélecteur de fichiers d'iOS ne s'y
   ouvre pas. La liste précise est à la fin de `AUDIT-vague-2-parcours.md` :
   les deux jeux enregistrés, une notification reçue et touchée, une photo prise
   à la caméra, une HEIC choisie dans la pellicule, le Wake Lock, l'haptique.
4. **Effacer les données de démonstration** avant la mise en service.
5. **Révoquer le jeton Vercel** de la session de développement.

**Ce qui n'est PAS branché, et pourquoi** : le projet Vercel n'est pas relié à
GitHub. Chaque mise en ligne se lance à la main (`vercel --prod`), et c'est
pour ça que la production est restée six jours sur le lot H. Le relier
(`vercel git connect`) ferait partir un déploiement à chaque poussée — la note
de coordination en tête de `CLAUDE.md` dit « ne rebranche pas Vercel », donc ça
attend un feu vert explicite.

**Pour rejouer la suite de bout en bout** : elle dure une vingtaine de minutes,
et le serveur de développement a été fauché deux fois en plein milieu (tout ce
qui suit échoue alors en trois cents millisecondes sur « Connection refused »,
ce qui n'a rien d'une régression). En trois tranches, tout passe :

```bash
npx playwright test --project=iphone e2e/audit3.spec.ts e2e/captures.spec.ts \
  e2e/cloisonnement.spec.ts e2e/etats.spec.ts e2e/lot1.spec.ts e2e/lotA.spec.ts \
  e2e/lotB.spec.ts e2e/lotC.spec.ts
npx playwright test --project=iphone e2e/lotF.spec.ts e2e/lotG.spec.ts \
  e2e/lotK.spec.ts e2e/lotL.spec.ts e2e/lotM.spec.ts e2e/lotN.spec.ts e2e/lotO.spec.ts
npx playwright test --project=iphone e2e/lotP.spec.ts e2e/lotQ.spec.ts \
  e2e/performances.spec.ts e2e/production.spec.ts e2e/video.spec.ts
```

### Ce qu'il faut pour allumer R2 (lot M)

Rien n'est cassé sans, et rien ne change tant qu'il manque une valeur. Pour
basculer : créer un seau **privé** chez Cloudflare, un jeton « Object Read &
Write » limité à ce seau, poser les quatre variables de `.env.example`, puis
`npm run medias:migrer -- --garder` (migre sans vider), vérifier avec
`npm run medias:verifier`, vivre quelques jours avec les deux, et relancer
`npm run medias:migrer` pour libérer la place en base.

**Ce qui n'a pas pu être éprouvé :** que Cloudflare accepte la signature. Il n'y
a pas de compte. Le client a été vérifié contre la suite de tests publiée par
AWS (la signature tombe au caractère près) et contre un faux S3 en mémoire, et
le script de migration a vraiment déplacé 30 fichiers contre ce faux S3, avec
relecture et comparaison d'empreintes. Le premier vrai passage mérite quand
même `--garder`.

### Les cinq réponses (6 septembre, confirmées par la bande)

1. **Temps réel du lot N → SSE depuis une route Next.** Pas de Supabase
   Realtime ici, et le sondage actuel (1 à 3 s) est mou sur un vote simultané
   et inutilisable sur un duel de réflexe. SSE : gratuit, aucun compte, ~200 ms.
2. **Stockage → Cloudflare R2, décidé.** 10 Go contre 0,5 chez Neon, soit
   vingt fois, et aucun frais de sortie. La bande accepte le compte Cloudflare,
   qui est le seul coût. Lot M.
3. **Notifications poussées → oui, et large** : rejoindre une partie, mais
   aussi quelqu'un qui pose sa journée, un commentaire, une réaction,
   l'ouverture d'un scellé. Clés VAPID, un abonnement par appareil, réglables
   par type (Q1).
4. **Multi-téléphones → LES DIX jeux**, pas six. La bande a tranché.
5. **Le classement de points revient (P1).** Confirmé.

### Le registre : x100, et ce que ça veut dire ici

La bande demande explicitement du très cru, de l'humour noir, « aucune
limite ». Les deux seules limites gardées sont **celles que le plan écrit
lui-même** : rien qui vise un groupe pour ce qu'il est, rien de sexuel
impliquant des mineurs, et rien qui vise une personne réelle extérieure à la
bande. Tout le reste est ouvert — vocabulaire d'argot, confessions sexuelles
frontales, hontes intégrales, humour noir sur la mort, les ex, les ratages.

Les cartes sont des AMORCES d'aveu, pas des récits : « je n'ai jamais fait X »
se dit en une ligne, et c'est la table qui raconte. C'est aussi ce qui marche
le mieux en jeu.

### Les décisions du lot K, prises sans demander

- **Le pouls ne rapporte aucun point**, et un anti-rebond de cinq minutes
  remplace le dernier au lieu d'en créer un.
- **Le brouillon ne restaure pas le curseur de joie** : c'est le seul champ qui
  a toujours une valeur et se règle d'un geste. Il rattrape les mots.
- **La bulle « La bande » est partie** de l'écran Aujourd'hui : elle redisait
  la figure du jour, qui est en tête du fil, la première page.
- Le graphique dessine **une ligne par membre**. Le plan dit « trois maximum » ;
  la bande de démonstration en a quatre, la vraie en aura trois. Masquer
  quelqu'un serait pire que dépasser d'une ligne.

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

- **Les images des cartes : l'adresse en dépôt, les octets chez Wikimedia, et
  notre serveur au milieu.** Le plan disait « stocke l'URL et l'attribution en
  base » ; c'est un fichier engendré (`src/lib/jeux/contenu/images.ts`) plutôt
  qu'une table, parce que les cartes sont les mêmes pour toutes les bandes et
  que les recopier à chaque création n'apporterait rien. Les octets, eux, ne
  sont pas rapatriés : cinq cents images de bonne qualité pèsent plus de trente
  méga-octets, et les mettre dans le dépôt les ferait voyager à chaque
  déploiement pour une soirée par mois. C'est une route à nous
  (`/api/carte/[carte]`) qui va les chercher — le téléphone de la bande ne parle
  qu'à nous, et la route prend une CARTE, jamais une adresse : un relais ouvert
  aurait laissé n'importe qui faire partir des requêtes depuis notre serveur.

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
- **`e2e/production.spec.ts` rougit environ une fois sur trois en local**, sur
  un `ECONNRESET` en allant chercher une photo ou sur un `page.evaluate` qui
  expire. C'est le serveur de développement qui plie : ce test crée une bande,
  réencode une vidéo et la renvoie, pendant que les flux SSE des jeux tournent
  encore. Ce n'est pas un défaut du produit — relancé seul, il passe. À revoir
  si ça arrive aussi contre la production.
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
- `classementAssiduite` (`src/lib/badges.ts`) ne sert plus à aucun écran depuis
  le lot P : le plan demandait de remplacer « Assiduité de la semaine » par le
  graphique des déclencheurs. Le COMPOSANT a été retiré, la fonction et ses
  tests restent — elle est juste, et c'est le genre de chose qu'on redemande.
- `plusLongueSerie` et `serieEnCours` (`src/lib/badges.ts`) ne servent plus à
  aucun écran depuis A4. Elles restent, avec leurs tests : E4 refond les badges
  et tranchera. Ne pas les supprimer « au passage ».
- **Le stockage garde ses anciens noms** quand l'interface change : la table
  s'appelle `bande_photos` (elle porte les vidéos), le modèle des lieux
  s'appelle `Etiquette`. Renommer pour un mot d'interface, c'est une migration
  risquée sans rien de visible.

### Le lot P (les graphiques)

- **Une entrée ne porte que des IDENTIFIANTS de déclencheurs, jamais leurs
  noms.** C'est ce qui permet de renommer « Plante verte » en « Marie Janne »
  sans réécrire cinq cents journées — et c'est ce qui fait qu'un graphique qui
  compare sur le nom affiche poliment « aucun déclencheur coché » devant quatre
  cents journées qui en portent.
- **`locator("text")` de Playwright n'est pas le `<text>` d'un SVG**, et
  `innerText` ne marche pas dessus : « Node is not an HTMLElement ». Et l'ordre
  des éléments d'un SVG suit le DESSIN, pas la lecture — le premier `<text>`
  d'une courbe est un prénom en bout de ligne, pas la date de gauche.
- **Deux étiquettes en bout de ligne se superposent dès que deux personnes sont
  au coude à coude**, ce qui est le cas normal dans une bande de trois. On
  écarte les étiquettes, pas les courbes, et un trait fin rattache chacune à la
  sienne.
- **Cinquante-deux semaines sur la largeur d'un iPhone font des barres d'un
  pixel et demi.** Au-delà de six mois, le graphique des déclencheurs compte par
  MOIS — et il faut alors afficher l'année, sinon « 1er août → 1er sept. »
  raconte un mois là où il y en a quatorze.

### Le lot O (les images, et trois jeux de plus)

- **Wikimedia ne fabrique plus de vignette à la demande.** Remplacer `330px-`
  par `800px-` dans l'adresse rendue par l'API rend un 400 et une page HTML :
  « Use thumbnail sizes listed on… ». Seules les tailles DÉJÀ fabriquées
  répondent, et elles ne se devinent pas — mesuré sur un fichier au hasard, 330,
  500 et 1280 passaient, 320, 400, 640, 800 et 1024 non. L'API classique
  (`action=query&prop=pageimages&pithumbsize=800`), elle, a le droit de
  fabriquer : on lui demande la vignette et on garde l'adresse qu'elle rend,
  quitte à ce qu'elle arrondisse à 960.
- **Un refus de débit ressemble à une page absente** si on ne regarde que « ça a
  marché ou pas ». La première version du script a annoncé « aucune page » pour
  onze footballeurs d'affilée, tous parfaitement présents. Distinguer les cas et
  réessayer avec patience a fait passer la récolte de 200 à 237 cartes.
- **Une virgule finale est légale en TypeScript et interdite en JSON.** Le
  script relit son propre fichier engendré pour ne pas tout refaire ; le
  `JSON.parse` levait en silence, la table revenait vide, et chaque relance
  refaisait les cinq cents requêtes. Une heure perdue pour une virgule.
- **Un jeu qui dure toute la soirée ne doit pas compter comme « la partie en
  cours »**, sinon il interdit de jouer à autre chose pendant trois heures —
  c'est-à-dire exactement le contraire de ce qu'il est. D'où `Jeu.fond`, et deux
  requêtes séparées dans le dépôt.

### Le lot N (multi-téléphones)

- **Deux jeux sur dix ne se jouaient pas, et les tests d'archétype l'ont montré.**
  « Le jugement » figeait : l'écran du juge publiait lui-même la phase de
  résultat, or `publierPhase` est réservé à l'hôte — l'appel échouait en silence
  une fois sur deux, selon le tirage de l'ordre de passage. « Menteur » n'avait
  pas d'écran de vote du tout : son archétype est « tour », et `EcranTour` ne
  connaissait que les deux formes de « Devine qui je suis » et du « jugement ».
  Leçon : **un test par forme d'écran**, pas un test par jeu — mais aucune forme
  sans test.
- **Un défaut de colonne n'est pas une dispense de dire ce qu'on veut.** Le lot N
  a fait du multi le mode par défaut du schéma (`mode @default("multi")`,
  `etat @default("salon")`). `lancerPartie`, qui démarre le mode d'un seul
  téléphone, ne posait ni l'un ni l'autre : chaque partie naissait « multi »,
  coincée dans un salon que personne n'avait ouvert, et **le mode d'un seul
  téléphone ne démarrait plus du tout**. Quinze tests du lot G le disaient, et
  ils attendaient un bouton renommé — donc ils mouraient sur autre chose, et le
  vrai défaut restait caché derrière. Corollaire : `terminerPartie` pose
  maintenant aussi `etat: "finie"` et `code: null`, sans quoi une partie terminée
  gardait l'état où elle était morte — bandeau « rejoindre » éternel, code encore
  valable.
- **`router.refresh()` pendant le rendu est une bombe à retardement.** Il
  reprogramme un rendu, qui le rappelle, et comme un rafraîchissement recharge
  TOUTES les routes en cache du client, deux téléphones suffisaient à noyer le
  serveur sous les requêtes de quatre parties à la fois. La ligne était là depuis
  le début du lot N et n'avait jamais brûlé — parce que `etat` ne passait jamais
  à « finie ». Corriger la donnée a allumé la mèche : c'est le genre de défaut
  qu'on ne trouve qu'en réparant autre chose.
- **Un écran ne publie pas de phase.** `publier` ne sort plus de la coquille :
  un écran envoie des actions, et faire avancer la partie est le travail de
  l'hôte. C'est la règle qui manquait, et son absence ne se voyait pas.

- **Une absence ne fait bouger aucune version.** Le flux ne recharge l'état
  complet que lorsque la version change, et un battement de cœur ne la change
  pas — sinon trois téléphones rechargeraient la partie toutes les cinq
  secondes. Mais personne ne publie « je suis parti » : sans une relecture à
  part de la liste des présents, un joueur disparu restait « présent » jusqu'à
  la reconnexion du flux (cinquante secondes), et pendant ce temps la manche
  attendait sa réponse et personne ne pouvait reprendre la main.
- **Un écran sans phase ne doit pas afficher de boutons.** L'hôte qui ferme
  l'application dans la seconde qui suit le lancement ne publie jamais la
  première manche : les autres voyaient alors l'écran de vote au complet, avec
  des boutons qui n'envoyaient rien (la réponse part dans la phase en cours, et
  il n'y en avait pas). La coquille affiche « L'hôte distribue… » tant que
  `etat.phase` est nul, et la reprise de main règle le reste.
- **Un jeu « tour » où l'acteur est seul à répondre n'est pas un jeu de vote.**
  `toutLeMondeARepondu` exclut l'acteur ; dans « Devine qui je suis », il ne
  reste donc personne à attendre et la manche ne se révélait jamais. C'est la
  réponse de l'ACTEUR qui clôt la phase, et il faut la verser dans les données
  de la phase pour que le dépouillement y voie `trouve`.
- **React ne compare pas la valeur d'un champ à son état, mais à celle qu'il a
  notée au dernier événement.** Remplir « 5732 » par-dessus un « 5732 » écrit
  avant l'hydratation ne lui fait voir aucun changement : pas de `onChange`,
  pas d'état, et un bouton désactivé pour toujours. Un test qui réessaie le même
  remplissage échoue cent fois de la même façon — il faut repasser par le vide.
- **`page.goto()` annule l'action serveur en vol.** Cliquer « Terminer » puis
  partir aussitôt laisse la partie en cours ; le test suivant trouve alors les
  fiches de jeu bloquées et meurt quarante secondes plus loin sur un bouton qui
  n'existe pas. On attend le podium avant de naviguer.
- **Un pseudo suivi d'un marqueur se lit collé dans un instantané
  d'accessibilité** : « Momo » + « toi » donne « Momotoi », ce qui ressemble à
  un peuplement périmé et fait chercher au mauvais endroit pendant un moment.
- **Un clic qui court contre une horloge mesure la chance du harnais.** Appuyer
  « avant le vert » dans « Le plus rapide » dépend d'un délai tiré au hasard et
  du moment où la page s'affiche : la règle du départ brûlé se vérifie sur le
  dépouillement, en Vitest, où l'horloge est à nous.
- **Un fichier de tests ne laisse pas de vaisselle sale aux suivants.** Le lot N
  libérait la bande au DÉBUT de chaque test, ce qui suffit tant qu'il tourne
  seul ; dans la suite complète, sa dernière partie multi bloquait les seize
  tests du lot G, qui cherchaient « Abandonner » — le mot du mode d'un seul
  téléphone, absent de l'écran multi. Un `afterAll` libère maintenant la bande,
  et `tableRase` (lot G) connaît les deux sorties.
- **Un `goto` lancé juste après l'entrée dans l'application se fait annuler.**
  La redirection côté client est encore en vol quand le titre du fil apparaît :
  « interrupted by another navigation ». Ce n'est pas du réseau, c'est un
  croisement — une seule reprise suffit (`aller()` dans `e2e/lotN.spec.ts`), et
  sans elle un test sur neuf rougissait une fois sur trois.

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
| J le geste (vague 2) | **fait** |
| K la journée (vague 2) | **fait** |
| M médias et stockage | **fait**, avec deux écarts assumés : miniature à 640 px et non 320 (le fil l'affiche sur toute la largeur de la carte, 320 y serait mou), et pas d'AVIF (mesuré : ce moteur ne sait pas l'encoder, il rend un PNG en silence) |
| L le fil | **fait** : pagination par journée, en-tête collant, appui long, partage 9:16, repère de visite, filtres, tirer pour rafraîchir |
| P les deux graphiques | **fait**, avec **un écart** : la règle « jamais plus de trois lignes » vaut pour la bande réelle, qui en compte trois. La bande de démonstration en a quatre, et on trace les quatre — cacher quelqu'un de son propre classement serait pire qu'une ligne de trop |
| O le reste des jeux | **fait** : images Wikipédia (237/494 cartes, le reste en texte), « Le plus rapide » refait, trois jeux Marie Janne. **Un écart** : les images ne sont pas en base mais dans un fichier engendré, et les octets ne sont pas rapatriés — voir « Décisions » |
| N les dix jeux en multi | **fait** : salon à code, SSE, trois archétypes, dix recettes, reprise de main, barre de score et podium |
| O2 le registre | **fait** : 423 cartes « Je n'ai jamais », 204 dilemmes, 38 gages, 80 susceptibles, 50 jugements, 47 thèmes |
