# Lot H — Les quatre audits

> Fait le 6 septembre 2026, sur la branche `claude/daily-joy-tracker-app-gjkdyd`.
> Tout ce qui est marqué **fait** a été vérifié, pas déduit du code.

---

## Audit 1 — Fonctionnel

`PLAN.md`, point par point. Une ligne d'explication pour tout ce qui n'est pas
« fait ».

### Partie 0 — Les règles du jeu

| Point | État | Note |
| --- | --- | --- |
| 0.1 `ETAT.md` tenu à jour | **fait** | Mis à jour à la fin de chaque tâche |
| 0.1 `CLAUDE.md` | **fait** | Architecture, pièges, correspondance avec le vocabulaire Supabase du plan |
| 0.1 Commit par tâche | **fait** | Un commit par lot ou sous-lot, message expliquant le pourquoi |
| 0.1 Le dépôt compile toujours | **fait** | `tsc`, `eslint --max-warnings 0` et `next build` verts à chaque commit |
| 0.2 Ne pas refactoriser ce qui marche | **fait** | Seules deux exceptions, forcées : `depot.ts` scindé (il frôlait mille lignes) et les types des jeux sortis du dépôt (ils cassaient la compilation) |
| 0.2 Une dépendance par lot | **fait** | Lot 2 : `mp4-muxer`. Lots A, C à H : **aucune** |
| 0.2 Tests sur la logique de calcul | **fait** | 306 tests unitaires, tous sur des modules purs |
| 0.3 Playwright iPhone/WebKit | **fait** | 71 tests de bout en bout, WebKit gabarit iPhone 15 |
| 0.3 `100dvh`, champs 16 px, cibles 44 px, zones sûres | **fait** | Classes `champ-saisie`, `cible-tactile`, `zone-sure-*` |
| 0.3 HEIC converti avant envoi | **partiel** | Le transcodage passe par `createImageBitmap`, qui décode le HEIC sur Safari mais **pas** sur les navigateurs de bureau. Sur iPhone — la seule cible — ça marche ; ailleurs, l'envoi est refusé avec un message clair plutôt que de laisser une image cassée |
| 0.3 `navigator.vibrate` en repli silencieux | **fait** | Testé par la présence de la clé, jamais appelé à l'aveugle |
| 0.3 `DeviceOrientationEvent.requestPermission` sur un vrai tap | **fait** | Bouton « Activer l'inclinaison », jamais au chargement |
| 0.3 Lisible en portrait ET en paysage | **fait** | L'inclinaison ne dépend pas de l'orientation : voir `lib/jeux/inclinaison.ts` |
| 0.3 Wake Lock pendant les parties | **fait** | Repris au retour d'arrière-plan, ce que la plupart des mises en œuvre oublient |
| 0.4 Migrations additives, aucun `DROP` de données | **fait** | 12 migrations relues avant application ; `Media` reste mappé sur `bande_photos` pour cette raison |

### Lot A — Renommages et accueil

| Point | État | Note |
| --- | --- | --- |
| A1 calme → rire, plante verte → Marie Jane, anecdote, Lieu | **fait** | Migration `UPDATE`, pas de recréation : les 496 journées gardent leur historique |
| A2 Le fil en page d'accueil, voile, révélation | **fait** | Le voile **vide** les entrées côté serveur ; il ne les floute pas en CSS |
| A3 Photo et nom modifiables | **fait** | Recadrage au doigt, carré de 256 px envoyé |
| A4 Retirer les trois compteurs | **fait** | Et pas de points de série non plus, par cohérence (voir lot E) |
| A5 Album personnel + stats discrètes | **fait** | Quatre traits, chacun se tait faute de données |

### Lot B — Photos

| Point | État | Note |
| --- | --- | --- |
| B1 HEIC → WebP, EXIF, 1600 px, miniature 320 px | **fait** | Miniature stockée à part, servie au fil |
| B1 Barre de progression, reprise, file hors-ligne | **partiel** | Progression et reprise : faites. **File d'attente hors-ligne : non.** Un envoi lancé sans réseau échoue et se redemande ; il n'est pas mis en attente pour partir plus tard |
| B2 Visionneuse plein écran | **fait** | Pincer, déplacer, balayer, double-tap = réaction, préchargement des voisines |
| B2 View Transitions | **fait autrement** | Transition par `layoutId` de Motion : les View Transitions n'existent pas dans le WebKit de Playwright, donc invérifiables ici |
| B3 Prendre une photo depuis l'app | **fait** | Deux entrées distinctes : `capture` ferme la pellicule sur iOS |
| B4 Abstraction `stockage.ts` + bascule R2 | **fait autrement** | Les octets vivent dans PostgreSQL. Une abstraction pour un stockage qu'on n'a pas serait l'abstraction « au cas où » que le 0.2 interdit |
| B4 Écran stockage : espace, par personne, par type | **fait** | Dans les réglages, avec le plafond Neon annoncé |
| B4 Bouton pour libérer de la place | **non** | Supprimer « les doublons » demande de comparer des images ; supprimer « les vidéos les plus lourdes » revient à effacer des souvenirs sur un critère de poids. À reprendre si le quota devient un vrai problème |
| B5 Vidéos courtes | **fait**, 8 s | Pas 15 : à 720p, 15 s pèsent le double, et le plafond de 0,5 Go de Neon est la vraie contrainte |

### Lot C — Les scellés

| Point | État | Note |
| --- | --- | --- |
| C1 Quatre types | **fait** | Mot, photo, vidéo, audio |
| C2 Création depuis Aujourd'hui et Souvenirs | **fait** | |
| C3 Sablier, aperçu flouté, décompte | **fait** | L'aperçu est **illisible dans ses octets** (32 px de côté), pas flouté en CSS |
| C4 Empilement au-delà de trois | **fait**, au-delà de deux | |
| C5 L'ouverture est un événement | **partiel** | L'animation et le passage aux souvenirs : faits. **La notification poussée : non** — elle demande des clés VAPID, un abonnement par appareil et un service d'envoi |

### Lot D — Souvenirs, stats, rétrospective

| Point | État |
| --- | --- |
| D1 Nouvel ordre de la page | **fait** |
| D2 Rétrospective repliée en pied de page | **fait** |
| D3 Stats resserrées | **fait** |

### Lot E — Points et badges

| Point | État | Note |
| --- | --- | --- |
| E1 Barème unique | **fait**, avec trois écarts assumés et argumentés dans le code |
| E2 Anti-abus, plafond 100/jour hors jeux | **fait** | Et un plafond de 120/jour **pour** les jeux, que le plan n'avait pas prévu |
| E3 Cinq niveaux | **fait** |
| E4 Huit badges maximum, dont un secret | **fait** |
| E5 Classement de points | **non, volontairement** | À trois, un classement de points est un classement de présence. Les niveaux montent seuls et ne se comparent à personne |

### Lot F — Le lieu

| Point | État | Note |
| --- | --- | --- |
| F Bouton « utiliser ma position » | **fait** | Permission demandée par le geste |
| F Politique d'usage de Nominatim | **fait** | Route serveur, cache, `User-Agent` identifiable |
| F Coordonnées arrondies | **fait** | Deux décimales, **avant** l'envoi et avant le stockage |
| F Carte Leaflet + tuiles OSM | **fait autrement** | Constellation SVG. Chaque tuile est une requête vers un tiers, et la suite des tuiles demandées dit où sont les souvenirs. Un test échoue si une requête sort vers un autre hôte |

### Lot G — Les jeux

| Point | État | Note |
| --- | --- | --- |
| G0 Section Jeux, catégories, fiche standard | **fait** | Règles lisibles avant de lancer |
| G0 Modèle commun partie / manches / scores | **fait** | Une table de parties, une de manches, un champ `jeu` |
| G0 Deux modes | **partiel** | « Un seul téléphone » seulement. « Chacun son téléphone » supposait du temps réel ; ici c'est un sondage à une ou trois secondes, invisible dans le fil et désastreux sur un vote simultané |
| G0 Classement discret, podium, conversion en points | **fait** | |
| G0 Wake Lock, reprise, abandon | **fait** | |
| G1 « Devine qui je suis » | **fait** | Inclinaison indépendante de l'orientation, repli tactile **toujours** actif |
| G1 Quinze paquets de soixante cartes | **partiel** | Douze paquets, 494 cartes (35 à 48 par paquet, pas 60), plus « Nos potes ». Les paquets peuvent grossir sans redéploiement du côté de la bande, pas du côté des constantes |
| G1 Mode roulette et paquets personnels | **fait** | La roulette prend aussi « Nos potes » |
| G2–G4 Trente-cinq jeux | **dix jeux** | C'est la demande de la bande (« il en faut au moins 10 »), et le plan lui-même prévenait : « mieux vaut trois jeux impeccables que dix bâclés » |
| Le cadre (gorgée, plafond, « je passe », sobre, rappel d'eau) | **fait** | Dans le moteur, pas dans chaque jeu |

---

## Audit 2 — Visuel

Captures WebKit iPhone 15, dans `captures/iphone/`.

**Écrans pleins** (bande de démonstration, 400 jours) : fil, aujourd'hui, jeux,
souvenirs, galerie, profil, réglages, stats.

**États vides** (bande créée pour l'occasion) : `vide-*.png` pour six écrans.

**États particuliers** : `etat-introuvable.png`, `etat-bienvenue.png`,
`etat-reprendre.png`, `etat-code-refuse.png`.

### Ce que les captures ont trouvé, et qui est corrigé

| Défaut | Où | Correction |
| --- | --- | --- |
| La constellation des lieux illisible : un lieu à Nantes écrasait cinq lieux parisiens en une tache, avec cinq étiquettes empilées | Souvenirs | Placement mêlant linéaire et rang, étiquettes qui se poussent |
| Le podium disparaissait à l'instant où il s'affichait | Fin de partie | Une partie finie garde son podium, et il survit à un rechargement |
| Un vote unanime faisait marquer tout le monde | Tu préfères | Il n'y a de minorité que si les deux camps ont une voix |
| Podium à quatre premières places et trois marches égales | Je n'ai jamais | Personne ne monte quand personne n'a gagné |
| Un titre de section au-dessus de rien | Souvenirs, bande neuve | La section disparaît avec son contenu |
| Dix jeux qu'une bande d'une personne ne peut pas lancer, sans explication | Jeux, bande neuve | Un encart dit pourquoi et mène au code d'invitation |
| Page 404 et écran d'erreur en anglais | Partout | Deux écrans en français |

**Reste à vérifier à la main, sur un vrai iPhone** : le rendu HEIC d'une photo
prise à l'instant, le micro, l'appareil photo, l'inclinaison de « Devine qui je
suis ». Aucun des trois ne s'automatise : le WebKit de Playwright n'a pas
`MediaRecorder`, pas de caméra et pas d'accéléromètre.

---

## Audit 3 — Technique

| Contrôle | Résultat |
| --- | --- |
| `next build` | **Compilé sans avertissement**, 28 routes |
| `tsc --noEmit` | **Propre**, TypeScript strict, aucun `any` |
| `eslint --max-warnings 0` | **Propre** |
| Tests unitaires | **306**, 24 fichiers |
| Tests de bout en bout | **71**, 11 fichiers, WebKit iPhone 15 |
| `console.log` oubliés | Aucun. Deux `console.error` délibérés : l'écran d'erreur, et l'échec de préparation d'un média |
| Taille du code servi | **332 Ko gzip** tous morceaux confondus (1,1 Mo non compressé) ; aucune page ne les charge tous |

### Le cloisonnement entre bandes, éprouvé pour de vrai

Le plan demandait de la RLS ; ici l'autorisation est écrite à la main côté
serveur, donc elle **peut être oubliée**. `e2e/cloisonnement.spec.ts` crée une
bande, se connecte avec **une session parfaitement valide**, et essaie
d'atteindre les adresses privées d'une autre bande :

- photo, miniature, aperçu de scellé, contenu de scellé, avatar → **refusés**,
  et **aucun octet ne sort** avec l'erreur ;
- l'écran d'une partie d'une autre bande → **introuvable**, pas « interdit » :
  la différence dirait qu'elle existe ;
- le fil de l'intrus ne contient rien, son export non plus.

Les mêmes adresses sans aucune session : refusées aussi.

### Requêtes par écran — aucune N+1

Comptées côté PostgreSQL (`log_statement='all'`), sur la bande de démonstration
(1 318 journées, 4 membres) :

| Appel | Requêtes |
| --- | --- |
| `chargerContexte` (toutes les pages) | 5 |
| `listerEntrees` (fil, profil, jeux de données) | 10 |
| `mediasDeLaBande` 120 (galerie) | 2 |
| `versionBande` (sondage toutes les 8 s) | 7 |
| `historiqueParties` (jeux) | 4 |
| Les autres | 1 à 2 |

Toutes **constantes**, aucune ne croît avec le nombre de lignes.

### Ce qui ne va pas, et ce que je propose

**Chaque écran charge tout l'historique.** `listerEntrees` sans borne rend
521 Ko de JSON en 122 ms pour 1 318 journées. Ça ne se voit pas aujourd'hui —
le fil n'affiche que les derniers jours — mais ça croît linéairement : à trois,
cinq ans font environ 5 500 journées, soit quatre fois plus, sur **chaque**
navigation, avec la latence de Neon en plus. À reprendre avant la troisième
année : borner le fil et calculer les stats par agrégats côté base.

**Un test interrompu laisse une bande fantôme.** Les tests qui créent une bande
la font partir dans un `finally`, mais si le navigateur meurt avant, la bande
reste. Douze traînaient dans la base locale, effacées. Sans conséquence en
production tant qu'on n'y lance pas de test raté.

**Pas de file d'attente hors-ligne pour les envois** (B1). L'application
fonctionne hors ligne en lecture ; un envoi lancé sans réseau échoue et se
redemande.

---

## Audit 4 — Parcours réel

| Parcours | État |
| --- | --- |
| Une bande neuve, de bout en bout, puis effacée | **fait** — `e2e/production.spec.ts`, exécutable contre la production sans rien y abîmer |
| Trois comptes, journée complète | **fait** — la bande de démonstration a quatre membres et 400 jours |
| Une partie de chaque catégorie | **fait** — un test par jeu, dix jeux |
| Coupure réseau au milieu d'un envoi | **non testé automatiquement** — à faire à la main, en mode avion |
| Réinstallation de la PWA | **non testé automatiquement** — le WebKit de Playwright n'installe pas de PWA |

---

## Ce qui reste, en une liste

1. **Déployer.** Impossible depuis la session qui a écrit ce document : la
   ligne de commande Vercel y est refusée par le garde-fou de l'environnement,
   et le connecteur Vercel disponible est authentifié sur un autre compte. Tout
   est poussé ; `npx vercel deploy --prod` depuis une machine avec le jeton
   suffit, et les migrations partent avec le `vercel-build`.
2. **Révoquer le jeton Vercel** gardé pour la durée de la session.
3. **Effacer les données de démonstration** avant la mise en service, comme
   décidé le 5 septembre.
4. Vérifier à la main sur iPhone : HEIC, micro, caméra, inclinaison, coupure
   réseau, réinstallation de la PWA.
5. Un jour : borner le chargement de l'historique, la file d'attente
   hors-ligne, la notification d'ouverture des scellés.
