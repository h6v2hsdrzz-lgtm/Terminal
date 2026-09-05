# Journal des versions

Les entrées vont de la plus récente à la plus ancienne. Chaque lot du chantier
v3 y ajoute une section ; les jalons v2 sont regroupés en tête d'historique.

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
