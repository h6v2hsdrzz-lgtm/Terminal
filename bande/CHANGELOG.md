# Journal des versions

Les entrées vont de la plus récente à la plus ancienne. Chaque lot du chantier
v3 y ajoute une section ; les jalons v2 sont regroupés en tête d'historique.

## Lot A — Renommages et profil

Premier lot du plan de travail (`PLAN.md`), qui entre au dépôt avec `ETAT.md`
et `CLAUDE.md`.

### Renommé
- **« Plante verte » devient « Marie Jane ».** Une migration `UPDATE`, pas une
  recréation : la ligne garde son identifiant, donc les 496 journées qui la
  portaient restent cochées et les statistiques d'effet gardent leur
  historique. Un `DELETE` suivi d'un `INSERT` aurait emporté la table de
  liaison par cascade.
- « Ce qui a fait la journée » devient **l'anecdote**.
- « Étiquettes » devient **Lieu**, dans le champ et dans l'export.

### Ajouté
- **On change son nom** depuis le profil. Comme le pseudo n'est recopié dans
  aucune journée, le passé change avec — on ne relit pas ses souvenirs sous un
  nom qu'on n'a plus.
- **Une photo de profil**, recadrée au doigt dans une fenêtre ronde. Ce qui
  part au serveur est un carré de 256 pixels ; l'originale ferait stocker
  quatre méga-octets pour un rond de quarante.
- **« Toi, en petit »** : les dix derniers médias de la personne, et quatre
  traits — l'heure à laquelle elle pose sa journée, le lieu qui revient, la
  part de vocaux, le mot qui revient. Chacun se tait quand il n'y a pas de quoi
  le dire.

### Déplacé
- **Le fil est la première chose qu'on voit** en ouvrant l'application. Le
  check-in a sa propre adresse, `/aujourdhui`, et une carte d'appel en tête du
  fil y mène — avec la figure du jour dedans.
- **Le fil porte le voile.** Il ne l'avait pas : il affichait tout en clair. En
  faire la page d'ouverture sans y porter le voile aurait suffi à casser la
  mécanique du produit — ouvrir l'application aurait donné à lire tout le
  monde, et personne n'aurait plus écrit ce qu'il pense vraiment. Seule la
  journée en cours est masquée ; le passé reste lisible.
- « Calme » devient **« rire »**. La colonne garde son nom : l'échelle est la
  même, et renommer une colonne pour un mot d'écran serait une migration
  risquée sans rien de visible.

### Retiré
- **Les trois compteurs du profil** — « jours d'affilée », « ton record »,
  « journées posées ». Un journal n'est pas un tableau de performance, et
  c'était la seule chose de l'écran qui donnait envie de poster pour le
  compteur plutôt que pour la journée.

### Corrigé
- **Un changement de nom ou de photo n'arrivait jamais chez les autres.** Il ne
  touche à aucune journée, donc l'empreinte de synchronisation ne bougeait pas.
  `Membre.modifieLe` y entre — même défaut que les photos et les notes vocales
  avaient eu, même correction.
- **`chargerContexte` chargeait les octets de chaque avatar à chaque page.**
  Un `include` tire toutes les colonnes ; sur un champ `Bytes`, ça se compte en
  méga-octets par navigation. Sélection explicite, et la présence d'une photo
  se demande à part.
- **Une entrée vidée n'est pas une entrée cachée.** Le voile met la joie à
  zéro ; sans le dire à la carte, l'écran affichait un gros « 0 » et « 0,0 de
  moyenne ». Ça ne cachait rien et laissait croire à une journée épouvantable.
- La base de démonstration disait « le plus souvent repos ». Ce n'est pas un
  lieu, et le champ s'appelle « Lieu » : les données doivent dire la même chose
  que l'interface.

### Une précision d'architecture
`PLAN.md` a été écrit en supposant **Supabase**, qui n'est pas la pile de ce
dépôt. Les garanties sont tenues autrement et la traduction terme à terme est
dans `CLAUDE.md` : la RLS devient l'autorisation côté serveur, les buckets
privés deviennent des routes qui exigent une session, Realtime devient le
sondage d'une empreinte de version.

## Lot 2 — La vidéo, et la partie photo devenue un vrai album

### Ajouté
- **La vidéo.** Jusqu'à huit secondes par média, réencodée **dans le
  navigateur** avant l'envoi : 720 pixels de côté long, H.264, débit calculé
  d'après le nombre de pixels. Une vidéo d'iPhone de huit secondes pèse une
  quinzaine de méga-octets et retombe autour du méga-octet — l'ordre de grandeur
  d'une photo. Ce n'est pas une optimisation : c'est ce qui rend la vidéo
  possible sur une base gratuite d'un demi-giga-octet.
- **Des vignettes** pour chaque média, fabriquées dans le navigateur. Le fil et
  la galerie ne servent plus que celles-là. Avant, une case de cent soixante
  pixels tirait une image de mille quatre cents — et pour une vidéo, le fichier
  entier.
- **La galerie** : tout ce que la bande a posté, en mosaïque, groupé par mois,
  avec un liseré de la couleur de chacun et le plein écran qui défile d'un média
  à l'autre. On y entre depuis les souvenirs — cinq onglets remplissent déjà la
  largeur d'un iPhone.
- **Des légendes** sous les photos et les vidéos, à poser et à corriger après
  coup.
- **Six médias par journée** au lieu de quatre, photos et vidéos mêlées.
- Dans le fil, une vidéo se lit **muette, en boucle, et seulement quand on la
  regarde** — le son n'arrive qu'en plein écran, qu'on a ouvert exprès.
- **La place occupée**, dans les réglages, avec le plafond de l'hébergement
  gratuit. Cette application ne coûte rien, et ce n'est pas gratuit par magie ;
  le dire vaut mieux qu'un refus d'envoi le jour où la base est pleine.
- Le mur des souvenirs retient désormais **les vidéos et les notes vocales**.
  Une journée où quelqu'un a filmé ou parlé en est un.

### Ce que la sonde du moteur a montré
- **Le WebKit de Playwright n'a pas `MediaRecorder`** — pas même pour l'audio.
  Ce n'est pas Safari sur iPhone, c'est une compilation Linux de WebKit. En
  revanche il a **WebCodecs au complet** : H.264, AAC, Opus. Le réencodage passe
  donc par `VideoEncoder`, qui est aussi la seule voie laissant choisir la
  résolution *et* le débit — `MediaRecorder` suit la cadence de lecture et ne
  garantit aucune taille.
- Sonder avant d'écrire a évité de construire tout le lot sur une API absente
  du seul moteur où l'on peut le vérifier.

### Corrigé pendant le chantier
- **Le transcodage ne se terminait jamais.** La première version capturait les
  images en laissant la vidéo jouer, via `requestVideoFrameCallback`. Ça dépend
  du compositeur : un élément `<video>` qui n'est pas dans le document n'est
  peint par personne, aucune image n'arrive, et l'écran reste sur « Envoi… »
  indéfiniment. Les images sont maintenant prises en déplaçant le curseur — ça
  ne dépend que du décodeur, et ce n'est pas tenu par le temps réel : huit
  secondes de vidéo ne prennent plus huit secondes.
- **Chaque déplacement est borné dans le temps.** Un déplacement qui n'aboutit
  pas n'émet jamais son événement ; sans délai, on réintroduisait le blocage
  qu'on venait de corriger.
- **La présence d'une note vocale à l'écran tenait au hasard.** Le mur ne les
  comptait pas, et le peuplement n'en garantissait aucune : le test qui allait
  la chercher passait une fois sur deux. Le mur les compte, et la base de
  démonstration en garantit trois sur les dix derniers jours.

### Deux défauts qui ne se voyaient pas encore
- **L'aperçu des souvenirs chargeait tous les médias de la bande pour en
  montrer huit.** Invisible la première année, c'est une page qui ne charge plus
  la cinquième.
- **La galerie n'avait aucune borne.** Elle en affiche cent vingt, et le reste
  tient dans un lien — un vrai lien, qui marche sans JavaScript et se partage.

### Le schéma
La table des photos gagne quatre colonnes — `genre`, `vignette`, `duree`,
`legende` — et **garde son nom**. Le modèle Prisma, lui, s'appelle désormais
`Media`. Prisma ne sait pas reconnaître un renommage de table : il produirait un
`DROP TABLE` suivi d'un `CREATE`, c'est-à-dire la perte de toutes les photos
déjà en ligne. Un nom de table un peu daté coûte moins cher.

## Lot 1 — La figure du jour, et de quoi raconter une journée

### Le concept
- **La figure du jour.** Un sommet par personne, tiré vers l'extérieur par sa
  note ; le contour en pointillés derrière est la journée parfaite. On y lit
  d'un coup ce qu'aucun chiffre ne montre aussi vite : si la bande est d'accord
  (figure régulière), si quelqu'un vit autre chose (figure penchée), s'il manque
  quelqu'un (sommet effondré). Ce n'est pas un classement — c'est une forme, et
  elle n'a de sens qu'à trois ou quatre.
- Une journée à 1 garde un tiers du rayon. **Aucune note n'est punie** : c'est
  une présence, pas un point.
- La phrase qui accompagne la figure **ne nomme jamais personne** et se tait
  plus souvent qu'elle ne parle. Dire « untel décroche » serait un classement
  déguisé ; le sommet court se voit déjà, dans la couleur de la personne.
- **Le mur des formes**, dans les souvenirs : les vingt-huit derniers jours
  côte à côte. Une figure est un dessin, trente figures sont une année.

### Ajouté
- **Un titre en trois mots** sur la journée, avant la note. C'est ce qu'on
  relira dans un an.
- **Des étiquettes libres**, avec les propositions de la bande. « Soirée »,
  « soiree » et « SOIRÉE » sont la même : la normalisation est partagée entre
  le navigateur et le serveur, dans un seul module, pour qu'elle ne diverge pas.
- **Énergie et calme**, deux curseurs facultatifs repliés derrière « aller plus
  loin ». Ils n'entrent dans aucune moyenne et dans aucun classement. Un curseur
  auquel on n'a pas touché ne vaut pas cinq : il ne vaut rien, et l'écran
  affiche un tiret.
- **Jusqu'à quatre photos** par journée, en carrousel à défilement natif avec
  ouverture en plein écran.
- **Une note vocale de trente secondes**, avec sa forme d'onde mesurée à
  l'enregistrement. Le format est choisi à l'exécution — MP4/AAC sur iPhone,
  WebM/Opus ailleurs — et la piste micro est relâchée à la fin, sans quoi la
  pastille orange de l'iPhone reste allumée.
- Base de démonstration : titres, étiquettes, curseurs et **de vraies notes
  vocales** — un encodeur WAV de cent lignes, dont on mesure les niveaux, pour
  que l'onde affichée soit celle du son qu'on entend.
- Aujourd'hui, la base de démonstration fait poster tout le monde **sauf** le
  premier profil : c'est l'état dans lequel on ouvre l'application le soir, et
  le seul où le voile, la figure et le formulaire se jugent ensemble.
- Sept tests de bout en bout sur WebKit pour le lot, et quarante-huit tests
  unitaires de plus (géométrie de la figure, normalisation des étiquettes,
  mise à l'échelle de la forme d'onde, export CSV).
- **Un test de fumée exécutable contre la production.** Il se crée sa propre
  bande, y déroule tout le rituel, puis la quitte — et le dernier membre qui
  part emporte le groupe avec lui. Il ne touche à aucune donnée existante, ce
  qui est la seule façon d'éprouver une mise en ligne sans l'abîmer.

### Corrigé
- **Une note vocale restait muette sur les autres téléphones.** Enregistrer un
  son ne modifie pas la ligne de la journée : sans agrégat dédié, l'empreinte de
  synchronisation ne bougeait pas et la note n'arrivait qu'au prochain
  commentaire. Même défaut que les photos avaient eu, même correction.
- **L'export CSV annonçait huit colonnes et en écrivait treize.** Le tableur
  ouvrait le fichier sans broncher et rangeait les commentaires sous
  « photos ». L'en-tête est complet, et un test compare désormais les largeurs.
- **Appuyer sur une étiquette proposée ne l'ajoutait pas.** Le champ perdait le
  focus, ce qui posait le mot à moitié tapé, refiltrait la liste et faisait
  disparaître le bouton sous le doigt avant l'arrivée du clic.
- **Une journée écrite hors ligne perdait son titre et ses étiquettes** au
  renvoi : la file d'attente ne gardait que la note et les déclencheurs.

## Lot 0 — Fondations et iPhone

### Corrigé
- **Safari zoomait à chaque mise au point d'un champ.** Les trois zones de
  saisie multi-lignes et les champs simples étaient sous 16 px ; iOS zoome alors
  la page et ne dézoome jamais seul. Une classe `champ-saisie` porte désormais
  la règle, pour que le prochain champ ajouté l'hérite au lieu de refaire la
  faute.
- **Zones tactiles sous 44 px** sur les pastilles de réaction, le bouton
  d'ajout de réaction, le choix d'émoji et les onglets. La zone est étendue par
  un pseudo-élément, sans gonfler la mise en page.
- **Le clavier de l'iPhone recouvrait le champ en cours de saisie.** La barre
  d'onglets s'efface tant que le clavier est ouvert, détecté par
  `visualViewport` — `window.innerHeight` ne bouge pas sur iOS.
- **`navigator.vibrate`** : test de présence explicite et commenté, puisque la
  fonction n'existe pas sur iOS, qui est précisément la cible.
- **Zones sûres** appliquées aussi au rail de bureau.

### Corrigé (suite)
- **Les statistiques annonçaient des effets qui n'en sont pas.** Avec treize
  cents journées, l'incertitude devient minuscule et *tout* passe le test
  statistique : « Plante verte +0,2 » s'affichait comme un résultat. Un second
  garde-fou répond à l'autre question — « est-ce que ça compte ? » — et exige
  au moins trois dixièmes de point.
- **Six tests de capture passaient en photographiant l'écran d'accueil.** WebKit
  refuse les cookies `Secure` sur `http://localhost` là où Chromium les tolère :
  la session ne tenait pas, et les tests validaient une page vide. La suite vise
  le serveur de développement, et chaque test vérifie d'abord qu'il est connecté.

### Ajouté
- `playwright.config.ts` versionné, avec un projet **iPhone 15 sur WebKit** et
  un projet bureau 1440×900. WebKit et ses dépendances système sont installés.
- `src/lib/mouvement.ts` : quatre ressorts nommés par leur usage. Les
  composants ne contiennent plus une seule valeur d'animation en dur.
- Jetons CSS de durée et de courbe.
- Seed réaliste : **quatre** profils sur quatre cents jours, avec des traversées
  (un creux de trois semaines puis une remontée), 150 photos engendrées sans
  dépendance — un encodeur PNG de quatre-vingts lignes plutôt qu'une
  bibliothèque ou des binaires commités — 178 réactions et 96 commentaires dont
  des échanges à deux voix.
- Suite Playwright : captures des six écrans sur les deux cibles, et quatre
  contrôles iPhone automatiques (taille des champs, cibles tactiles,
  débordement, zone sûre).
- Ce fichier.

---

## v2 — l'application complète (jalons 1 à 8)

- **Jalon 8** — PWA installable, mode hors-ligne avec file d'attente, rail de
  navigation sur grand écran, mise en ligne.
- **Jalon 7** — souvenirs : « ce jour-là », mur des moments, capsules
  temporelles, rétrospective mensuelle avec image partageable.
- **Jalon 6** — vingt-et-un badges et classement d'assiduité, jamais sur le
  bonheur.
- **Jalon 5** — cent-huit tests sur la logique pure.
- **Jalon 4** — synchronisation en temps réel par sondage, photos, export,
  départ avec effacement.
- **Jalon 3** — réactions, commentaires, correction de sa journée, réglages de
  la bande.
- **Jalon 2** — base PostgreSQL, identité sans compte, code de reprise.
- **Jalon 1** — le châssis visuel et la palette validée.

### Corrigé après la mise en ligne
- Le voile laissait passer le contenu des autres dans le HTML et dans les
  propriétés sérialisées du composant client. Le serveur les vide désormais
  avant l'envoi.
- Les formulaires bâtis sur `useTransition` rendaient
  `action="javascript:throw ..."` et ne partaient pas sans JavaScript.
- Le départ définitif dépendait d'un bouton JavaScript ; c'est un `<details>`.
