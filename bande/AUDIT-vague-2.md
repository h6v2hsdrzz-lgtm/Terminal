# Audit de la vague 2 — fonctionnel

> Lot R, audit n° 1. `PLAN.md` repris point par point, sans rien arrondir.
> Trois états : **fait**, **partiel**, **pas fait**. Tout ce qui n'est pas
> « fait » porte une ligne d'explication — et quand la décision a été de faire
> autrement, elle est dite plutôt que maquillée.

**Résumé : 44 points sur 47 faits, 3 partiels, 0 pas fait.** Les trois partiels
sont : la purge automatique des originaux (le script existe, le déclencheur
automatique non), AVIF (mesuré inutile, décision assumée), et Lighthouse (pas
mesurable depuis cet environnement — à faire à la main sur l'adresse en ligne).

---

## LOT J — Renommage et nettoyage

| | Point | État |
| --- | --- | --- |
| J1 | « Marie Jane » → « Marie Janne » partout | **fait** |
| J2 | Fil : supprimer la pastille « vous y êtes tous » | **fait** |

J1 : migration de libellé (`20260906140000_marie_janne`), aucune donnée perdue.
Les seules occurrences restantes de l'ancien nom sont dans le SQL des migrations,
où c'est l'histoire et pas un oubli.

---

## LOT K — « Aujourd'hui »

| | Point | État |
| --- | --- | --- |
| K1 | Boutons média inversés, vrais pavés, bande de vignettes | **fait** |
| K2 | « Sceller quelque chose » : sablier animé, feuille à quatre types | **fait** |
| K3 | Le pouls et le graphique rire / énergie, bascule 7 jours si vide | **fait** |
| K4 | Ergonomie : ordre, brouillon continu, clavier, retour franc | **fait** |

---

## LOT L — Le fil

| | Point | État |
| --- | --- | --- |
| L1 | En-tête de date collant | **fait** |
| L2 | Pagination infinie + retour en haut après deux écrans | **fait** |
| L3 | Appui long = menu rapide (5 actions) | **fait** |
| L4 | Partage d'une journée en image 9:16 | **fait** |
| L5 | Repère « nouveau depuis ta dernière visite » | **fait** |
| L6 | Filtres tout / photo / vocal / personne | **fait** |
| L7 | Tirer pour rafraîchir sans faire sauter le défilement | **fait** |

L6 porte une subtilité qui n'est pas dans le plan et qui compte : sous filtre
média, la journée voilée des autres est **retirée** au lieu d'être vidée. Une
carte vide sous « avec photo » dirait « cette journée a une photo », soit un bit
du contenu que le voile existe pour retenir.

---

## LOT M — Médias et stockage

| | Point | État |
| --- | --- | --- |
| M1 | Bascule Cloudflare R2, script de migration, vérification | **fait** |
| M1b | Purge automatique des originaux après 7 jours | **partiel** |
| M2 | Deux tailles par image | **fait** (640 et 1600, pas 320) |
| M3 | HEIC → WebP, orientation EXIF | **fait** |
| M3b | AVIF quand c'est supporté | **partiel** — décision assumée |
| M4 | Réglages → Stockage : jauge, répartition, libérer de la place | **fait** |
| M5 | Envoi en arrière-plan, file, reprise après coupure | **fait** |
| M6 | Visionneuse : pincer, balayer, fermer, précharger, compteur | **fait** |

**M1b.** `scripts/migrer-medias.ts` déménage et vérifie, et `--garder` permet de
ne rien vider au premier passage. Ce qui manque est le **déclencheur
automatique** : aujourd'hui c'est une commande qu'on lance. Pour une bande de
trois, c'est un geste tous les six mois, et l'automatiser demanderait un
deuxième cron — le palier gratuit de Vercel n'en autorise qu'un, déjà pris par
le réveil du matin.

**M2.** 640 pour la miniature et pas 320 : la grille de la galerie fait trois
colonnes sur un écran à trois fois la densité. Une image de 320 y est
visiblement molle. C'est écrit dans `src/lib/media.ts`.

**M3b.** AVIF **n'est pas** utilisé, et ce n'est pas un oubli : mesuré sur le
WebKit de Playwright, `toBlob("image/avif")` rend **silencieusement un PNG**,
c'est-à-dire plus lourd que le WebP qu'on produit. Vérifier `blob.type` est la
seule façon de s'en apercevoir. Le jour où Safari encodera vraiment l'AVIF, la
liste des formats est à un endroit.

**M6.** Le double-tap **réagit** au lieu de zoomer. Les deux ne peuvent pas
coexister sur le même geste, le pincement zoome déjà, et « aimer » n'avait aucun
autre geste. Écrit dans le fichier.

---

## LOT N — Les jeux à trois téléphones

| | Point | État |
| --- | --- | --- |
| N1 | Le multi devient le mode par défaut, un seul téléphone en secours | **fait** |
| N2 | Salon, notification, bandeau « rejoindre », code à 4 chiffres, présence | **fait** |
| N3 | État sur le serveur, écran selon le rôle dans la manche | **fait** |
| N4 | Reconnexion, verrouillage, départ, délai, transfert d'hôte | **fait** |
| N5 | Wake Lock, bandeau de score, podium, points d'app | **fait** |
| N6 | Actions optimistes, mais horloge serveur pour la vitesse | **fait** |

N3 : le plan disait « Realtime ». Ici c'est un flux SSE qui relit une colonne de
version quatre fois par seconde — la traduction est dans `CLAUDE.md`. La
garantie est la même : les trois écrans lisent la même phase au même moment.

N4 : la présence est un battement de cinq secondes, une absence se déclare à
vingt, et n'importe quel joueur présent peut reprendre la main. Éprouvé à deux
contextes de navigateur, c'est-à-dire deux téléphones.

---

## LOT O — Contenu et qualité des jeux

| | Point | État |
| --- | --- | --- |
| O1 | Photos sur « Devine qui je suis », lisibles à deux mètres, crédit | **fait** |
| O1b | Écran « fais deviner » pour les deux autres en multi | **fait** |
| O2 | Le registre hardcore sur tous les jeux | **fait** |
| O3 | « Le plus rapide » refait : plein écran, 3-2-1, délai, duel, best-of-5 | **fait** |
| O4 | Les trois jeux Marie Janne | **fait** |
| O5 | Règles avant le lancement, chargement, écran de fin, jouable de bout en bout | **fait** |

O1 : **237 cartes sur 494** ont une image. Les autres se jouent en texte, et
c'est écrit dans la fiche du jeu. La source a changé en cours de route : l'API
`rest_v1/page/summary` du plan ne fabrique plus de vignette à la demande, il a
fallu passer par `action=query&prop=pageimages`.

O4 : « Le mot de passe » tourne en arrière-plan des autres jeux, « La théorie du
complot » et « Le tribunal des idées » sont enregistrés et réécoutables dans les
souvenirs. Le renvoi du lendemain matin (le principe du tribunal) est branché
depuis le lot Q.

---

## Le registre

| | Point | État |
| --- | --- | --- |
| — | Vocabulaire cru, trois niveaux réellement différents | **fait** |
| — | ≥ 400 « Je n'ai jamais », ≥ 200 « Tu préfères » | **fait** |
| — | Montée en intensité sur gages, défis, questions, paquets | **fait** |
| — | La bande ajoute ses propres cartes et les partage | **fait** |
| — | Les deux limites tenues | **fait** |
| — | Garde-fous : gorgée, « je passe », joueur sobre | **fait** |

Les volumes sont **verrouillés par un test** (`contenu.test.ts`) : 400 minimum
pour « Je n'ai jamais » dont 100 par niveau, 204 dilemmes, et l'unicité vérifiée.
Un jeu qui perdrait des cartes le dirait au prochain `npm test`.

---

## LOT P — Les deux graphiques

| | Point | État |
| --- | --- | --- |
| P1 | Évolution du classement, points cumulés, encart, trois périodes | **fait** |
| P2 | Déclencheurs dans le temps, couleurs distinctes, trois pastilles | **fait** |
| P3 | Les sept règles communes, sur les trois graphiques | **fait** |

P2 : au-delà de six mois le pas passe au **mois** — cinquante-deux semaines sur
la largeur d'un iPhone font des barres d'un pixel et demi. Et sous cinq
journées, un tiret : « 8,4 sur deux journées » a l'air d'un résultat et n'en est
pas un.

---

## LOT Q — Ce qui manquait

| | Point | État |
| --- | --- | --- |
| Q1 | Réglages complets : notifications, thème, confidentialité, stockage, bande, déconnexion | **fait** |
| Q2 | Erreurs et hors-ligne visibles, bandeau, réessayer, rien en silence | **fait** |
| Q3 | Liens profonds : la bonne journée, la bonne partie | **fait** |
| Q4 | Sauvegarde et export complets (JSON + CSV + médias) et l'import | **fait** |
| Q5 | Recherche globale | **fait** |
| Q6 | Performances : images à la bonne taille, listes bornées, aucun décalage | **fait** |
| Q6b | Lighthouse mobile ≥ 90 | **partiel** — pas mesurable ici |
| Q7 | Écran « Nouveautés » | **fait** |

**Q6b.** Lighthouse n'est pas installable dans cet environnement, et surtout il
mesurerait le serveur de **développement** : pas de minification, pas de
découpage de paquets, une recompilation à la première visite de chaque route. Un
score de 40 en développement ne dit rien d'un score en production, et un score
de 90 encore moins. **À lancer à la main contre l'adresse en ligne.**

Ce qui a été mesuré à la place, et qui ne dépend pas du mode, est dans
`e2e/performances.spec.ts` : le décalage de mise en page sur quatre écrans (sous
0,1, la barre de Lighthouse), les dimensions déclarées de chaque image, et la
borne des listes. Le build de production sort par ailleurs **sans un seul
avertissement**.

**Q6 · « listes virtualisées au-delà de 100 éléments »** est devenu « listes
bornées par page ». Virtualiser une grille d'images à hauteur variable coûte un
composant de trois cents lignes et casse la position de défilement à chaque
retour ; une borne par page fait le même travail pour une bande de trois. La
décision est écrite dans `borneGalerie`, avec ses tests.

---

## Ce que l'audit a trouvé en chemin

Trois choses, corrigées au passage plutôt que listées :

1. **Sept appels jetaient l'erreur que le serveur leur rendait** — dont le
   retrait d'une journée, qui est la règle numéro un du produit. Quelqu'un
   pouvait croire sa journée effacée alors qu'elle était toujours là.
2. **Le champ de fichier de la restauration était à 13 px** : Safari iOS zoome
   sous 16 px et ne redescend jamais. Attrapé par le test des champs, pas à
   l'œil.
3. **La galerie chargeait tout** sur « tout voir » : sur trois ans de bande,
   plusieurs milliers de cases d'un coup.

---

## Ce qui reste, et qui n'est pas du code

- **Lighthouse mobile** contre l'adresse en ligne, à la main ;
- **poser `CRON_SECRET` chez Vercel**, sinon le réveil du matin refuse tout le
  monde — ce qui est le bon défaut, mais veut dire qu'il ne fait rien ;
- **poser les clés VAPID** (`npm run pousse:cles`), sinon l'écran de réglages
  annonce que les notifications ne sont pas branchées ;
- **effacer les données de démonstration** avant la mise en service ;
- **révoquer le jeton Vercel** de la session de développement ;
- **l'essai sur un vrai iPhone** : le WebKit de Playwright n'a ni
  `MediaRecorder`, ni `PushManager`, ni `Notification`. Micro, caméra, sélecteur
  de fichiers iOS et notifications ne s'y éprouvent pas.
