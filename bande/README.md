# Journal de joie — le repaire de la bande

Version 2, en cours de construction. La v1 (`joie/`) reste en ligne pendant ce
temps et n'est pas touchée.

## État : jalon 1 livré — le châssis visuel

Ce qui existe aujourd'hui : la direction artistique et les quatre écrans, avec
des données factices. Aucun serveur, aucune base — c'est volontaire. On juge
l'allure avant d'écrire la logique, parce qu'une interface ratée sur laquelle
on a déjà branché une base coûte trois fois plus cher à reprendre.

```bash
cd bande
npm install
npm run dev      # http://localhost:3000
```

## Les décisions prises au jalon 1

**La journée ferme à 4 h du matin, pas à minuit.** Un check-in à 1 h appartient
encore à la soirée qu'on vient de vivre. C'est aussi ce qui rend cohérent le
badge « noctambule », impossible autrement.

**Pas de rouge, jamais.** L'échelle de joie n'est pas un feu tricolore : c'est
une seule famille chaude, du discret au rayonnant. Une journée à 2 s'affiche
avec la même dignité qu'une journée à 9, simplement plus calme. C'est la règle
la plus importante du produit, et elle est dans les jetons de couleur, pas dans
une note de bas de page.

**Les cinq teintes de profil sont validées, pas choisies à l'œil** — bande de
clarté, plancher de chroma, séparation en vision daltonienne, contraste sur la
surface, pour chaque thème séparément. Le sombre n'est pas l'inverse du clair :
ce sont deux jeux choisis.

**Inter est servie par l'application**, pas par un CDN : la typographie ne
dépend d'aucun tiers joignable, et rien ne fuite vers Google.

**Le visage n'est pas un emoji** mais un tracé dont la bouche s'incurve avec la
note. Un emoji aurait plafonné à douze expressions figées et changé de dessin
d'un téléphone à l'autre.

## Ce que le jalon 1 ne fait pas encore

Pas de base de données, pas de compte, pas de temps réel, pas de photos. Les
réactions et commentaires sont affichés mais inertes. La courbe et le
calendrier ne réagissent pas encore au survol : les interactions arrivent au
jalon 5, avec les vraies données.

## Structure

```
src/
├─ app/            les quatre écrans (Aujourd'hui, Fil, Stats, Profil)
├─ composants/     visage, avatar, carte, curseur, barre d'onglets, graphiques
└─ lib/
   ├─ couleurs.ts  teintes de profil et rampe de joie — jamais de code en dur
   ├─ dates.ts     le jour de la bande, et sa bascule à 4 h
   ├─ analyse.ts   moyennes, effets, corrélation — avec leurs garde-fous
   └─ factices.ts  données de démonstration, supprimées au jalon 2
```
