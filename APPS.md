# Applications

Les apps (Journal de joie, et les suivantes) vivent dans le dépôt **privé** :

https://github.com/h6v2hsdrzz-lgtm/App

- v1 → `App/joie/`
- v2 → `App/bande/`
- prochaines apps → un dossier à la racine de `App/`, **pas ici**

Ce dépôt `Terminal` est le trading / Bloomberg, et rien d'autre.

## Les copies sont parties

`joie/` (66 fichiers) et `bande/` (327, sur la branche de travail) ont été
retirés. Chacun des deux avait une raison vérifiée, et non supposée :

| App | Ce qui la déploie | Pourquoi la copie d'ici ne servait à rien |
|---|---|---|
| **v2** (`bande`) | Vercel ↔ GitHub, dépôt `App`, branche `main`, racine `bande` | Un push sur `App/main` a déclenché seul une construction passée en READY, et la production a répondu derrière. Le déploiement a eu lieu depuis `App`. |
| **v1** (`joie`) | **Aucun dépôt** — envois manuels | La page Git de son projet Vercel affiche « Connected Git Repository » avec les quatre boutons à cliquer et **aucun « Disconnect »**, là où la v2 montre `h6v2hsdrzz-lgtm/App`. |

L'historique garde les deux copies si besoin : `git log -- joie` les retrouve.

Une seule chose à savoir si la v1 est un jour rebranchée sur `App` : son projet
Vercel a déjà `Root Directory = joie` et « Skip deployments when there are no
changes to the root directory » activé. Il ne manque que la connexion au dépôt.
