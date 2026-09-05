# Journal des versions

Les entrées vont de la plus récente à la plus ancienne. Chaque lot du chantier
v3 y ajoute une section ; les jalons v2 sont regroupés en tête d'historique.

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
