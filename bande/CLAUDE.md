@AGENTS.md

# Journal de Joie — repères d'architecture

`PLAN.md` (vague 2) est la source de vérité. `PLAN-vague-1.md` garde la vague 1,
à laquelle `AUDIT.md` renvoie. `ETAT.md` dit où on en est.
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
| Supabase Storage, buckets privés | Cloudflare R2 quand les quatre variables `R2_*` sont posées, PostgreSQL sinon. Dans les deux cas les octets passent par des routes qui exigent une session : le seau est privé, aucune adresse publique n'est fabriquée |
| Supabase Realtime | deux mécaniques selon l'enjeu : le reste de l'application sonde une empreinte de version (`versionBande`) toutes les trois secondes ; une **partie** passe par un flux SSE (`/api/partie/[partie]/flux`) qui relit la version quatre fois par seconde et n'envoie l'état complet que lorsqu'elle bouge |

## Où sont les choses

```
prisma/schema.prisma     14 modèles, tous préfixés bande_ (+ Entree.epingle, Membre.filVuLe)
prisma/seed.ts           4 profils × 400 jours, images et sons engendrés
src/app/(entree)/        bienvenue, créer, rejoindre, reprendre
src/app/(repaire)/       page.tsx (le fil), aujourdhui, jeux, souvenirs, galerie, profil, reglages,
                         recherche, jour/[jour] (une journée seule : recherche et liens profonds)
src/app/(jeu)/           l'écran d'une partie, sans barre d'onglets ni sondage
src/app/api/             photo, vignette, audio, avatar, scelle, lieu, export, sante, version,
                         reveil (le cron quotidien), partie/[partie]/{flux,present}
src/app/not-found.tsx    404 en français ; error.tsx pour ce qui casse
src/composants/          un fichier par composant, noms français ; jeux/ pour les dix jeux, jeux/multi/ pour le multi, fil/ pour le fil
src/lib/                 depot.ts + depot-jeux.ts (tout PostgreSQL), actions*.ts, logique pure
src/lib/graphiques.ts    ce que les graphiques du profil calculent ; trace.ts, le lissage
src/lib/stockage/        R2 : signature v4 écrite à la main, client, clés, plafond
src/lib/pousse/          notifications : RFC 8291/8188/8292 à la main, envoi, préférences
src/lib/recherche.ts     accents, casse, surlignage — sans dépendance ; reseau.ts, le bandeau
src/lib/archive.ts       un ZIP (méthode « stocké ») écrit et relu à la main ; nouveautes.ts, les écrans
scripts/migrer-medias.ts déménage les octets vers R2, avec relecture et empreintes
src/lib/jeux/            catalogue, cadre, tirage, recompense, quiz, top3, vote, inclinaison, salon, recettes, types
src/lib/jeux/contenu/    jamais, dilemmes, paquets, marie-janne, images (engendré)
scripts/images-cartes.ts récolte les images de Wikipédia pour « Devine qui je suis »
e2e/                     Playwright : captures, lot1, lotA..lotC, lotF, lotG, lotK, lotL, lotM, lotN, lotO, lotP, lotQ, video, production
e2e/aide-jeux.ts         deux téléphones dans un test : salon, code, libération, nouveautés
e2e/performances.spec.ts décalage de mise en page, tailles d'images, bornes de listes
e2e/audit3.spec.ts       le parcours réel à TROIS téléphones (lot R)
```

**La règle du dépôt :** rien d'autre que `depot.ts` et `depot-jeux.ts` ne parle
à Prisma. Ils rendent les types du domaine, jamais les lignes Prisma. Deux
fichiers parce qu'un seul frôlait les mille lignes ; la règle est la même.

**Attention aux types partagés avec le client.** Un composant client qui prend
ne serait-ce qu'une CONSTANTE dans un fichier de dépôt entraîne Prisma et `pg`
— donc `net`, `tls`, `fs`, `dns` — dans le paquet du navigateur, et la page ne
compile plus. Le `import "server-only"` n'arrête pas ça. Les types et les
constantes partagés vivent dans `src/lib/jeux/types.ts`, sans dépendance.

## Le multi-téléphones, en six phrases

Le **serveur garde l'état** (`Partie.etat/phase/donneesPhase/version`,
`ActionJoueur`), l'**hôte le fait avancer**, et tout le monde envoie des actions.
Les règles des dix jeux ne sont pas dans le serveur mais dans des **recettes**
(`src/lib/jeux/recettes.ts` : archétype, tirage, énoncé, dépouillement), que le
navigateur de l'hôte applique — y mettre les règles aurait fait du serveur un
moteur de jeu, alors qu'il n'a qu'une garantie à donner : que les trois écrans
lisent la même phase au même moment.

Cinq **archétypes** couvrent les treize jeux : `vote` (tout le monde répond),
`tour` (un joueur agit, les autres regardent ou jugent), `reflexe` (l'instant du
signal est annoncé à l'avance en absolu, et chaque téléphone compte chez lui),
`parole` (un joueur enregistre, les autres notent) et `fond` (le jeu tourne
pendant qu'on joue à autre chose). `jeuxSansRecette()` rougit si un jeu du
catalogue n'a pas de recette.

**Les images de « Devine qui je suis »** viennent de Wikipédia. Le fichier
engendré `contenu/images.ts` garde l'adresse et l'attribution ; les octets
passent par `/api/carte/[carte]`, qui prend une CARTE et jamais une adresse —
sinon ce serait un relais ouvert. Une carte sans image se joue en texte, et
c'est le cas d'une sur deux.

La **présence** est un battement de cinq secondes (`/present`), une absence se
déclare au bout de vingt, et n'importe quel joueur présent peut **reprendre la
main** si l'hôte ne donne plus signe de vie. Le battement n'incrémente PAS la
version : le flux relit donc la liste des présents à part, toutes les deux
secondes et demie, parce qu'une absence ne fait bouger aucune version.

**La règle des tests :** ce qui se calcule vit dans un module pur et se teste
(`figure`, `media`, `onde`, `etiquettes`, `csv`, `analyse`, `souvenirs`,
`badges`, `dates`, `lieu`, et tout `jeux/`). Le reste se vérifie dans
Playwright, sur WebKit.

## Le schéma, en une phrase chacun

`Groupe` la bande · `Membre` une personne (code de reprise en scrypt) ·
`Entree` une journée (joie, titre, note, énergie, **calme**, déclencheurs) ·
`Media` photo **ou** vidéo (table `bande_photos`, voir ci-dessous) ·
`Audio` la note vocale · `Etiquette` + `EntreeEtiquette` · `Declencheur` +
`EntreeDeclencheur` · `Reaction` · `Commentaire` · `Capsule` (scellé) ·
`Partie` + `ScorePartie` + `Manche` + `ActionJoueur` (les jeux) · `CarteBande`
(ce que la bande écrit elle-même) · `Parole` (ce qu'on a dit pendant un jeu, et
qu'on réécoute). La **manche 0** d'une partie n'est pas une manche : elle
range le décompte final, pour que le podium survive à un rechargement.

**Le modèle `Media` est mappé sur la table `bande_photos`.** Prisma ne sait pas
reconnaître un renommage de table : il produirait un `DROP` suivi d'un `CREATE`,
donc la perte des photos en ligne. Un nom de table daté coûte moins cher.

## Commandes

```bash
npm run dev            # http://localhost:3000
npm test               # Vitest, logique pure
npx playwright test --project=iphone   # WebKit, gabarit iPhone 15 — voir la note
                                      # ci-dessous : la suite entière dure ~20 min
                                      # et le serveur de dev ne tient pas toujours
npm run db:seed        # bande de démonstration + .codes-demo.txt
npm run cartes:images  # récolte les images des cartes (long : deux requêtes par carte)
npm run cartes:verifier # chaque adresse rend-elle vraiment une image ?
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
- **Un fichier « use server » ne peut exporter que des fonctions asynchrones.**
  Une constante exportée fait échouer tout le module d'actions, et l'erreur ne
  montre pas la ligne fautive.
- **Une pioche ne vit pas dans un `useMemo`.** React a le droit de le jeter ;
  le paquet est alors remélangé au milieu d'une manche. Référence obligatoire.
- **On n'écrit pas une référence pendant le rendu** (`ref.current = …` dans le
  corps du composant) : la règle `react-hooks/refs` le refuse, et elle a raison.
- **Un affichage optimiste doit utiliser l'identifiant rendu par le serveur.**
  Un identifiant inventé sur place rend la suppression suivante inopérante.
- **Après `prisma generate`, redémarrer `npm run dev`.** Le serveur garde en
  mémoire le client engendré au démarrage : une colonne ajoutée donne un
  « Unknown argument » qui ressemble à une erreur de code et n'en est pas.
- **`toBlob` avec un type non supporté rend un PNG, sans erreur.** Vérifier
  `blob.type` est la seule façon de savoir si l'encodage a eu lieu. (AVIF sur
  WebKit : silencieusement du PNG.)
- **Le poids d'un fichier est une COLONNE**, pas un `pg_column_size` : dès que
  les octets partent chez R2, la somme calculée tombe à zéro et la jauge de
  stockage annonce une base vide pendant que le seau se remplit.
- **`context.setOffline(true)` casse `createImageBitmap`** dans le WebKit de
  Playwright — artefact du harnais, pas du vrai iPhone. Pour éprouver une
  reprise après coupure, abattre la requête d'envoi avec `page.route`, pas le
  réseau entier.
- **`couleurProfil` rend `var(--profil-N)`, pas une couleur.** Un canvas ne sait
  pas résoudre une variable CSS, et `addColorStop` **lève** sur une couleur
  invalide : l'image entière disparaît au milieu du dessin, sans message.
  `resoudreCouleur` (dans `partage.ts`) la lit sur `document.documentElement`.
- **Un `<a download>` doit être dans le document**, et son adresse d'objet ne se
  révoque pas dans la foulée du clic : Safari ignore le premier cas sans erreur,
  et annule le téléchargement dans le second.
- **Le fil est un composant client** (`composants/fil/`) depuis le lot L, et
  le voile n'a pas bougé d'un pouce pour autant : c'est le serveur qui **vide**
  les entrées avant de sérialiser, ici comme dans l'action qui charge la suite.
  Un filtre « photos » ou « vocaux » ferait fuiter un bit du contenu voilé — il
  retire donc la journée des autres au lieu de la vider.
- **Un test qui dépend de la fraîcheur du peuplement rougit tout seul.** La
  bande de démonstration est figée au jour où elle a été engendrée ; un test qui
  suppose « untel a posé aujourd'hui » casse une semaine plus tard. Il pose.
- **Une partie ne se synchronise pas par sa seule version.** Un départ de
  joueur ne l'incrémente pas — personne ne publie « je suis parti ». Sans une
  relecture séparée des présents, la manche attend une réponse qui ne viendra
  jamais et personne ne peut reprendre la main.
- **Un écran de jeu sans phase publiée ne doit montrer aucun bouton.** Une
  réponse part dans la phase en cours ; s'il n'y en a pas, le bouton ne fait
  rien et ne le dit pas. `CoquilleMulti` affiche « L'hôte distribue… ».
- **React compare la valeur d'un champ à celle du dernier événement, pas à son
  état.** Réécrire la même chaîne par-dessus une valeur posée avant
  l'hydratation ne déclenche aucun `onChange` : le bouton reste désactivé pour
  toujours. Dans un test, repasser par le vide avant de remplir.
- **`page.goto()` annule une action serveur en vol.** Un test qui clique
  « Terminer » puis navigue laisse la partie ouverte, et bloque le test suivant.
- **Un écran de jeu n'a pas le droit de publier une phase** (`publierPhase` est
  réservé à l'hôte, et l'appel échoue en SILENCE). Il envoie une action ; c'est
  `CoquilleMulti`, chez l'hôte, qui en tire la suite. « Le jugement » est resté
  figé une fois sur deux à cause de ça — selon le tirage de l'ordre de passage.
- **`router.refresh()` ne s'appelle jamais pendant le rendu**, seulement dans un
  effet, et une seule fois (garde par référence). Il reprogramme un rendu qui le
  rappelle, et il recharge TOUTES les routes en cache : deux téléphones suffisent
  à noyer le serveur.
- **Ajouter un `@default` à une colonne ne dispense pas de la poser.** `mode`
  naît « multi » et `etat` naît « salon » depuis le lot N : `lancerPartie` (mode
  d'un seul téléphone) les laissait par défaut, et créait des parties coincées
  dans un salon que personne n'avait ouvert — le mode de secours ne démarrait
  plus. Toute création de `Partie` pose `mode` ET `etat`, et toute fin pose
  `etat` et `code`.
- **Un test par forme d'écran, et aucune forme sans test.** Les dix jeux tiennent
  en trois archétypes mais quatre formes d'écran (vote, tour-acteur-agit,
  tour-acteur-juge, tour-avec-préparation). Deux d'entre elles ne marchaient pas
  du tout, et ça ne s'est vu qu'en les jouant vraiment à deux téléphones.
- **Wikimedia ne fabrique plus de vignette à la demande** : remplacer `330px-`
  par `800px-` dans une adresse rend un 400. Il faut passer par l'API
  (`prop=pageimages&pithumbsize=`), qui a le droit de la fabriquer, et garder
  l'adresse qu'elle rend.
- **Un 429 ressemble à une page absente** quand on ne regarde que « ça a marché
  ou pas ». Distinguer les codes et réessayer a fait passer la récolte d'images
  de 200 à 237 cartes.
- **Une entrée porte des IDENTIFIANTS de déclencheurs, pas leurs noms.** Comparer
  sur le nom rend toutes les séries à zéro — et l'écran annonce poliment
  « aucun déclencheur coché » devant quatre cents journées qui en portent.
- **Le WebKit de Playwright n'a ni `PushManager` ni `Notification`** (mesuré, pas
  supposé). Un abonnement ne s'y éprouve donc pas ; ce qui s'y éprouve, c'est ce
  qu'un appareil sans pousse doit voir — et c'est aussi le cas d'un iPhone tant
  que l'application n'est pas sur l'écran d'accueil. Le chiffrement, lui, se
  vérifie en Vitest contre les intermédiaires publiés du RFC 8291.
- **`role="alert"` n'est pas à nous tout seuls** : Next.js en pose un, invisible,
  pour annoncer les changements de route. Un `getByRole("alert")` sur la page
  entière trouve deux éléments et échoue en mode strict. Idem pour les cases à
  cocher : l'écran de réglages en a d'autres que celles des notifications.
- **La clé publique VAPID part telle quelle dans `applicationServerKey`.** Elle
  voyage avec chaque abonnement et n'est pas un secret ; la PRIVÉE ne quitte
  jamais le serveur, et `.env` est ignoré par git.
- **Une action serveur qui rend `{ erreur }` ne sert à rien si l'appelant la
  jette.** Sept le faisaient, dont le retrait d'une journée. `sansSilence`
  (`src/lib/reseau.ts`) fait remonter l'échec au bandeau unique, avec de quoi
  réessayer ; le bandeau s'efface dès qu'une autre action passe, ce qui évite
  de rejouer une phase de jeu périmée.
- **Le voile s'applique aussi à la recherche, et il EXCLUT au lieu de vider.**
  Une entrée vidée qui apparaît quand même dirait « il y a ce mot dans la
  journée que tu ne peux pas lire ». C'est écrit dans le `where` Prisma, au plus
  près de la base.
- **Un test du voile ne doit pas dépendre du peuplement** : « ai-je posé
  aujourd'hui » change à chaque exécution de la suite. Le test crée sa bande,
  la remplit et la rend.
- **Vérifier qu'un test de sécurité échoue quand on retire la sécurité.** Celui
  du voile passait aussi bien avec le filtre qu'avec `false &&` devant : il a
  fallu le prouver pour savoir qu'il posait la bonne question.
- **Un ZIP écrit à la main se vérifie avec `unzip`, pas avec son propre
  lecteur.** La taille du répertoire central était calculée en argument d'une
  écriture — donc après que cinq champs avaient déjà fait avancer le curseur :
  douze octets de trop, archive refusée par tous les outils du monde, et un
  aller-retour maison parfaitement vert (il lit le NOMBRE d'entrées, pas leur
  taille).
- **Un voile plein écran casse toute la suite de tests d'un coup.** Les
  nouveautés s'ouvrent à la première visite, donc dans chaque contexte de
  navigateur neuf. `passerLesNouveautes` (dans `e2e/aide-jeux.ts`) est appelée
  par chaque `entrer` ; le seul test qui les regarde vraiment est dans
  `lotQ.spec.ts`, sinon le helper cacherait un bogue au lieu de contourner un
  voile.
- **`Uint8Array` n'est pas `Uint8Array<ArrayBuffer>`** : le premier accepte
  aussi un `SharedArrayBuffer`, que Prisma refuse pour une colonne `Bytes`.
  Resserrer la signature à la source (`lireOctets`, `lireR2`) évite une copie
  de chaque octet chez chaque appelant.
- **`prevenir` ne s'attend pas, sauf dans le cron.** Une fonction serverless qui
  rend sa réponse est GELÉE : une notification encore en vol à cet instant ne
  part jamais. `/api/reveil` passe donc par `prevenirEtAttendre`, et marque ce
  qu'il a envoyé seulement après.
- **Un envoi se marque APRÈS, jamais avant.** Marquer d'abord laisserait un
  scellé « annoncé » que personne n'a vu passer, et il ne se rattraperait jamais.
- **Un champ de fichier natif parle anglais**, et aucune règle CSS ne réécrit
  « Choose File » ni « no file selected ». Il faut le cacher (`sr-only`, mais en
  16 px : il reste focalisable) et faire du `<label>` le bouton.
- **Une barre collante se met en `bg-sol`, pas `bg-surface`** : le fond de page
  est `--sol`, et `--surface` y dessine une bande blanche pleine largeur.
- **Sans `loading.tsx`, Next garde l'écran PRÉCÉDENT** jusqu'à ce que le suivant
  soit prêt. Sur cinquante millisecondes c'est le bon comportement ; sur les
  huit cents millisecondes des souvenirs, l'application a l'air bloquée.
- **`error.tsx` n'est pas atteignable en abattant la charge d'une navigation** :
  Next abandonne la navigation côté client et recharge la page entière, qui
  aboutit. Il ne sert que quand le rendu lui-même casse.
- **Deux téléphones ne prouvent pas trois.** Deux défauts n'apparaissaient qu'à
  trois : le fil qui ignore une CORRECTION de journée (son empreinte ne
  regardait ni le titre, ni la note, ni les photos), et les boutons « Trouvé /
  Passer » absents chez les souffleurs — invisible à deux, où il n'y a qu'un
  souffleur qui n'en a pas besoin.
- **`[data-enonce]` est la marque à viser dans un écran de jeu.** Chercher
  l'énoncé par son texte attrape le conteneur au-dessus, émoji et nom du jeu
  compris. Même raison que `data-carte` dans le fil.
- **« MAINTENANT » se cherche en respectant la casse.** Un `/maintenant/i`
  attrape la consigne du décompte, les trois tapent trop tôt, et « Le plus
  rapide » annonce — correctement — que tout le monde a brûlé le départ.
- **Un test qui SALIT le peuplement commun casse les autres.** Un parcours du
  lot R posait la journée de Momo dans la bande de démonstration : quatre tests
  d'autres fichiers supposent le contraire (le voile veut que Momo n'ait rien
  posé, les renommages veulent le formulaire ouvert). Tout ce qui écrit une
  journée se fait dans une bande créée pour l'occasion, et rendue à la fin.
- **Un test qui écrit une donnée durable ne suppose pas son point de départ.**
  Les préférences de notification sont en base : un échec au milieu du test les
  laissait à l'envers, et le suivant rougissait pour une raison étrangère. On
  lit l'état, on le change, on le remet dans un `finally`.
- **Depuis `loading.tsx`, `page.goto()` rend la main sur le SQUELETTE.**
  `page.content()` juste après ne contient pas encore l'écran. C'est le bon
  comportement du produit ; les tests attendent le titre.
- **La suite entière dure une vingtaine de minutes, et le serveur de
  développement ne tient pas toujours jusqu'au bout** — il a été fauché deux
  fois en plein milieu, et tout ce qui suit échoue alors en trois cents
  millisecondes sur « Connection refused ». Ce n'est pas une régression : on
  relance `npm run dev` et on rejoue la fin. En trois tranches, tout passe :
  `audit3 captures cloisonnement etats lot1 lotA lotB lotC`, puis
  `lotF lotG lotK lotL lotM lotN lotO`, puis
  `lotP lotQ performances production video`.
- **`locator("text")` de Playwright n'est pas le `<text>` d'un SVG**, et
  `innerText` ne marche pas dessus. L'ordre des éléments d'un SVG suit le
  dessin, pas la lecture.
