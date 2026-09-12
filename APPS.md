# Applications

Les apps (Journal de joie, et les suivantes) vivent dans le dépôt **privé** :

https://github.com/h6v2hsdrzz-lgtm/App

- v1 → `App/joie/`
- v2 → `App/bande/`
- prochaines apps → un dossier à la racine de `App/`, **pas ici**

Ce dépôt `Terminal` est le trading / Bloomberg, et rien d'autre.

## Les copies sont parties de CETTE branche, et pourquoi c'était sans risque

`bande/` (327 fichiers) et `joie/` (66) ont été retirés de la branche
`claude/daily-joy-tracker-app-gjkdyd`. Deux faits, tous deux vérifiés, font que
rien en ligne n'en dépendait :

1. **La v2 construit depuis `App`.** Le projet Vercel est relié à GitHub sur
   `h6v2hsdrzz-lgtm/App`, branche `main`, racine `bande`. Ce n'est pas déduit
   d'un réglage lu quelque part : un push sur `App/main` a déclenché tout seul
   une construction qui est passée en READY, et la production a répondu juste
   derrière. C'est la preuve la plus solide qu'on puisse avoir — le
   déploiement a vraiment eu lieu.
2. **`joie/` est intact sur `main`.** `git ls-tree origin/main -- joie` rend ses
   66 fichiers. Quoi que lise le projet v1, la copie de `main` n'a pas bougé :
   retirer celle d'une branche de travail ne pouvait rien lui faire.

`bande/`, lui, n'existait QUE sur cette branche — `main` ne l'a jamais porté.

Ce qui n'est pas vérifié, et qui est donc écrit comme tel : **à quoi le projet
Vercel de la v1 est relié.** Le jeton disponible ici ne l'autorise plus à lire
l'API Vercel (403). Ça ne change rien au raisonnement ci-dessus, qui ne repose
pas dessus — mais ça veut dire qu'il reste une chose à faire un jour : retirer
`joie/` de `main`, et cela demande de savoir d'abord d'où la v1 déploie.

L'historique garde les deux copies si besoin.
