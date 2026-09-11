# Audit de la vague 2 — visuel

> Lot R, audit n° 2. Chaque écran et **chaque état** photographiés sur le WebKit
> de Playwright, gabarit iPhone 15, puis regardés un par un. Ce qui suit est ce
> que les images ont montré — pas ce qu'on espérait y voir.

Les captures sont versionnées dans `captures/iphone/` et se refont par
`npx playwright test --project=iphone e2e/captures.spec.ts e2e/etats.spec.ts`.
Les avant / après de cet audit sont dans `captures/audit-r/`.

## Ce qui a été photographié

| Famille | Ce qu'elle couvre | Fichiers |
| --- | --- | --- |
| Écrans pleins | fil, aujourd'hui, jeux, souvenirs, galerie, profil, réglages, recherche — avec quatre cents jours d'historique | `<écran>.png` |
| Les mêmes en sombre | les deux thèmes sont deux jeux de couleurs choisis, pas l'un dérivé de l'autre | `sombre-<écran>.png` |
| Bande neuve | les huit écrans d'une bande où **rien** n'existe encore | `vide-<écran>.png` |
| Portail | bienvenue, reprendre, et un code refusé | `etat-bienvenue`, `etat-reprendre`, `etat-code-refuse` |
| Introuvable | une adresse qui n'existe pas | `etat-introuvable` |
| Réseau | hors ligne, et un geste qui n'est pas passé | `etat-hors-ligne`, `etat-panne` |
| Chargement | le squelette, pendant qu'un écran se prépare | `etat-chargement` |
| Nouveautés | les cinq écrans de la première ouverture | `etat-nouveautes` |

## Les quatre défauts trouvés, et corrigés

### 1. Une bande blanche en travers de la recherche

*(`captures/audit-r/avant-recherche.png` → `apres-recherche.png`)*

La barre de recherche collante était en `bg-surface` — du blanc pur — alors que
le fond de page de toute l'application est `--sol`, un blanc cassé. Résultat :
un bandeau plus clair, pleine largeur, qui coupait l'écran en deux sans raison.
Invisible en lisant le code, évident sur l'image. Elle emploie maintenant la
même couleur que l'en-tête de date du fil.

### 2. « Choose File » et « no file selected », en anglais

*(`avant-reglages-bas.png` → `apres-reglages-bas.png`)*

Le champ de fichier de la restauration montrait les libellés natifs de Safari,
en anglais, au milieu d'une application qui est en français du premier au
dernier mot. **Aucun style ne réécrit ces deux chaînes** : il faut cacher le
champ et faire du libellé le bouton. C'est ce qui a été fait — « Choisir un
fichier », et le nom du fichier choisi en dessous.

### 3. « Restaurer » était rangé derrière « Quitter la bande »

*(même paire d'images)*

L'ordre était : Emporter, **Partir**, Restaurer. On ne range pas « remets tes
données » derrière le bouton qui les efface toutes. L'ordre est maintenant
Emporter → Restaurer → Partir, et « Partir » reste le dernier bloc de l'écran,
qui est sa place : c'est le plus définitif.

### 4. Aucun état de chargement, nulle part

*(`etat-chargement.png`)*

Il n'y avait pas de `loading.tsx`. Sans lui, Next garde l'écran **précédent**
affiché jusqu'à ce que le suivant soit prêt. Sur une navigation de cinquante
millisecondes c'est le bon comportement ; mais ces écrans lisent quatre cents
journées — mesuré en développement, avec la base en local : souvenirs 808 ms,
profil 355 ms. Avec Neon à l'autre bout, on touche « Souvenirs » et il ne se
passe **rien** pendant une seconde. On croit avoir raté le bouton, on retouche,
et on double la charge.

Un squelette : un titre, trois cartes, une respiration lente et décalée. Il dit
**où** le contenu va arriver, ce qu'un rond qui tourne ne dit pas.

## Ce que l'audit a trouvé et qui n'était pas un défaut

**L'écran d'erreur n'est pas atteignable de l'extérieur.** On a essayé : abattre
la charge d'une navigation devrait le déclencher. Next abandonne alors la
navigation côté client et **recharge la page entière**, qui aboutit. `error.tsx`
ne sert donc que quand c'est le rendu lui-même qui casse — ce qui est une bonne
nouvelle, et ce qui est désormais vérifié par un test plutôt que supposé.

**Les deux graphiques du profil s'ouvrent sur des fenêtres différentes** : trente
jours pour les points, quatre-vingt-dix pour les déclencheurs. Ça ressemble à un
oubli et n'en est pas un : le second compte **par semaine**, et trente jours ne
font que quatre barres. La raison est maintenant écrite dans le composant, pour
que personne ne « corrige » l'incohérence.

**Les grosses tuiles rayées bleues du profil** sont les images du peuplement de
démonstration, engendrées par `prisma/image-factice.ts`. Elles partiront avec la
bande de démonstration.

## Ce qui ne se photographie pas ici

Le WebKit de Playwright n'est pas Safari iOS. Il n'a ni `MediaRecorder`, ni
`PushManager`, ni `Notification`, et le sélecteur de fichiers iOS ne s'y ouvre
pas. **La caméra, le micro, la notification qui arrive et le choix d'une photo
dans la pellicule ne sont donc pas dans ces images** — ils sont dans l'audit 3,
celui qui se fait avec de vrais téléphones dans les mains.
