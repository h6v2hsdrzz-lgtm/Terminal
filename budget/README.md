# Prévoyant — budget prévisionnel

Application qui répond à une seule question : **combien me restera-t-il, et
quand est-ce que ça coince ?**

On saisit ce qui rentre et ce qui sort — un salaire, un loyer, une assurance
annuelle, un crédit qui se termine — et l'application place chaque échéance à sa
date, jusqu'à cinq ans, puis en tire le solde jour par jour, les mois difficiles,
les enveloppes tenues ou dépassées, et ce qui reste au bout.

**Un seul fichier.** `index.html` contient tout : styles, code, graphiques.
Aucune dépendance, aucune construction, aucun réseau. Les graphiques sont du SVG
écrit à la main. Ouvrez le fichier dans un navigateur, ou déposez le dossier sur
n'importe quel hébergement statique.

## Démarrage

```bash
python3 -m http.server 8000   # puis http://localhost:8000/budget/
```

Ou : ouvrez `index.html` directement. À la première ouverture, un budget
d'exemple est chargé — remplacez les montants par les vôtres, ou repartez de
zéro depuis les réglages.

## Vos données restent chez vous

Tout est écrit dans le stockage local du navigateur. Rien n'est envoyé nulle
part : il n'y a ni serveur, ni compte, ni requête sortante. La contrepartie est
que vider les données du site les efface — l'export JSON des réglages est votre
sauvegarde, et l'import la restaure sur un autre appareil.

Installée depuis le navigateur (« Ajouter à l'écran d'accueil »), l'application
fonctionne hors ligne : manifeste, icônes et service worker sont dans le dossier.

## Le modèle : des flux, rien d'autre

Tout ce qui est affiché découle d'une seule liste. Un **flux** dit combien, à
partir de quand, à quel rythme, et jusqu'à quand :

| Champ | Ce qu'il règle |
|---|---|
| Sens | revenu, dépense, ou **virement** entre deux de vos comptes |
| Montant | toujours positif : c'est le sens qui porte le signe |
| Rythme | ponctuel, hebdomadaire, quinzaine, mensuel, bimestriel, trimestriel, semestriel, annuel |
| Première échéance | la date à laquelle le rythme démarre |
| Dernière échéance | facultative — un crédit qui se solde, un contrat qui expire |
| Revalorisation | en % par an, appliquée à chaque date anniversaire |
| Compte | celui qui est débité ou crédité |

Deux choix méritent d'être explicités, parce qu'ils changent les chiffres :

**Le montant saisi est celui d'aujourd'hui.** Une revalorisation ne s'applique
donc qu'à partir de la date de départ de la projection, et par pas d'un an : une
augmentation tombe à date anniversaire, elle ne se lisse pas sur douze mois. Un
loyer entré à 780 € avec +2 %/an vaut 780 € cette année, 795,60 € l'an prochain.

**Un rythme mensuel se compte en mois, pas en 30 jours.** Un prélèvement du 31
tombe le 28 en février, puis revient au 31 en mars : le rabattement ne
contamine pas les échéances suivantes. C'est la raison pour laquelle chaque
échéance est recalculée depuis la date de début, jamais de proche en proche.

### Les virements ne sont ni des revenus ni des dépenses

Un virement vers le livret n'appauvrit personne : l'argent change de poche.
Il ne compte donc dans les totaux que si sa contrepartie est hors du périmètre
observé — sur l'ensemble des comptes, jamais ; sur un compte seul, toujours.
Vu de tous les comptes, les deux jambes se compensent et une seule ligne
s'affiche, à montant nul, pour que le virement reste visible à l'agenda.

Sans cette distinction, mettre 250 € de côté chaque mois ferait mécaniquement
chuter le taux d'épargne — ce qui est exactement l'inverse de ce qui se passe.

## Les huit vues

- **Tableau de bord** — solde d'aujourd'hui, solde à l'horizon, reste mensuel,
  taux d'épargne ; la courbe de solde jour par jour ; la date de découvert si
  elle existe, avec le montant qui manque pour tenir la période ; les
  quarante-cinq prochains jours ; où part l'argent.
- **Revenus & dépenses** — la liste des flux, cherchable et triable, avec pour
  chacun son équivalent mensuel, sa prochaine échéance et son total sur
  l'horizon. Une calculette d'annuité remplit le montant et la dernière
  échéance d'un crédit à partir du capital, du taux et de la durée.
- **Projection** — le détail mois par mois : revenus, dépenses, net, solde de
  fin de mois et point bas du mois. Chaque ligne se déplie sur ses opérations.
  Exportable en CSV.
- **Catégories** — la répartition, et une **enveloppe** mensuelle facultative
  par catégorie : la barre compare la moyenne projetée au plafond fixé.
- **Objectifs** — un montant et une date. L'application lit le solde projeté à
  cette date et dit ce qu'il manquerait, et combien de plus il faudrait mettre
  de côté chaque mois. Un objectif suivi sur un compte ne compte que ce qui y
  arrive.
- **Scénarios** — « et si ? ». Un scénario retire des flux, en ajoute, applique
  un pourcentage à tous les revenus ou à toutes les dépenses, décale le solde de
  départ — et sa trajectoire se superpose à la référence. Il ne modifie jamais
  vos flux : il les rejoue autrement.
- **Comptes** — soldes d'aujourd'hui et à l'horizon, compte par compte.
- **Réglages** — monnaie, horizon, seuil de sécurité, date de départ, thème,
  import/export.

## Ce que la projection ne dit pas

Le solde projeté n'est pas une prévision de ce qui arrivera : c'est la
conséquence arithmétique des flux saisis. Il vaut ce que vaut la saisie — un
abonnement oublié, et la courbe ment de son montant. Trois choses aident à s'en
approcher : reprendre trois mois de relevés plutôt que lister de mémoire ;
saisir les charges annuelles à leur date réelle plutôt que lissées, puisque
c'est précisément ce qui creuse les mois difficiles ; renseigner une
revalorisation sur les postes qui montent.

Rien ici n'est un conseil financier.

## Tests

Le moteur — échéances, projection, scénarios, objectifs, normalisation des
données — est couvert par des tests qui **extraient le script de `index.html`**
et l'évaluent hors navigateur. Il n'y a rien à construire, et c'est bien le code
livré qui est testé, pas une copie.

```bash
npm test          # ou : node --test tests/*.test.mjs
```

Aucune dépendance : le lanceur de tests intégré de Node (≥ 18) suffit.
