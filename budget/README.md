# Prévoyant — budget prévisionnel

Application qui répond à une seule question : **combien me restera-t-il, et
quand est-ce que ça coince ?**

On saisit ce qui rentre et ce qui sort — un salaire, un loyer, une assurance
annuelle, un crédit qui se termine — et l'application place chaque échéance à
sa date, jusqu'à cinq ans, puis en tire le solde jour par jour, les mois
difficiles, les enveloppes tenues ou dépassées, et ce qui reste au bout.

Puis elle se confronte à votre relevé, et vous dit de combien elle s'est
trompée.

**Un seul fichier.** `index.html` contient tout : styles, code, graphiques.
Aucune dépendance, aucune construction, aucun réseau. Les graphiques sont du
SVG écrit à la main. Ouvrez le fichier dans un navigateur, ou déposez le
dossier sur n'importe quel hébergement statique.

## Démarrage

```bash
python3 -m http.server 8000   # puis http://localhost:8000/budget/
```

Ou : ouvrez `index.html` directement. À la première ouverture, un budget
d'exemple est chargé — remplacez les montants par les vôtres, importez un
relevé bancaire, ou repartez de zéro depuis les réglages.

## Vos données restent chez vous

Tout est écrit dans le stockage local du navigateur. Rien n'est envoyé nulle
part : il n'y a ni serveur, ni compte, ni requête sortante — le relevé que
vous importez est lu sur place. La contrepartie est que vider les données du
site les efface, **y compris les sauvegardes automatiques** : l'export JSON
des réglages est la seule sauvegarde qui vous survive, et l'import la restaure
sur un autre appareil.

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
| Exceptions | une échéance précise corrigée, ou sautée |
| Compte | celui qui est débité ou crédité |

Deux choix méritent d'être explicités, parce qu'ils changent les chiffres :

**Le montant saisi est celui d'aujourd'hui.** Une revalorisation ne s'applique
donc qu'à partir de la date de départ de la projection, et par pas d'un an :
une augmentation tombe à date anniversaire, elle ne se lisse pas sur douze
mois. Un loyer entré à 780 € avec +2 %/an vaut 780 € cette année, 795,60 €
l'an prochain.

**Un rythme mensuel se compte en mois, pas en 30 jours.** Un prélèvement du 31
tombe le 28 en février, puis revient au 31 en mars : le rabattement ne
contamine pas les échéances suivantes. C'est la raison pour laquelle chaque
échéance est recalculée depuis la date de début, jamais de proche en proche.

### Ajuster une échéance sans toucher au flux

La facture d'énergie de ce mois-ci est plus lourde ; la prime tombe une fois
plus haut ; le prélèvement de mars n'aura pas lieu. Chaque échéance se corrige
individuellement — un montant pour ce jour-là, ou un saut — depuis le
calendrier, l'agenda du tableau de bord ou le détail d'un mois. Le flux, lui,
ne bouge pas : toutes les autres échéances gardent leur montant.

C'est ce qui sépare une prévision d'un tableur figé. Sans cela, il faudrait
choisir entre fausser toute la série et créer un flux ponctuel de rattrapage.

### Les virements ne sont ni des revenus ni des dépenses

Un virement vers le livret n'appauvrit personne : l'argent change de poche.
Il ne compte donc dans les totaux que si sa contrepartie est hors du périmètre
observé — sur l'ensemble des comptes, jamais ; sur un compte seul, toujours.
Vu de tous les comptes, les deux jambes se compensent et une seule ligne
s'affiche, à montant nul, pour que le virement reste visible à l'agenda.

Sans cette distinction, mettre 250 € de côté chaque mois ferait mécaniquement
chuter le taux d'épargne — ce qui est exactement l'inverse de ce qui se passe.

### Le reste à vivre, et le partage contraint / choisi

Chaque catégorie de dépense est marquée **contrainte** (elle tombe quoi qu'il
arrive : loyer, courses, crédits) ou **choisie** (loisirs, abonnements,
épargne). Le reste à vivre est ce qui reste des revenus une fois les
contraintes payées, par mois et par jour.

Le partage vient de vos catégories, pas d'un classement automatique : ce qui
est un loisir chez l'un est un besoin chez l'autre. Une catégorie non classée
est comptée comme contrainte — c'est l'hypothèse prudente.

## Partir d'un relevé bancaire

Saisir un budget à la main est le vrai obstacle : on oublie la moitié des
prélèvements, et on renonce. Un relevé CSV exporté depuis la banque contient
déjà tout. **Réglages → Importer un relevé bancaire** le lit en deux étapes.

**Lire le fichier.** Séparateur, guillemets et doublés, en-tête, formats de
date (`12/09/2026`, `2026-09-12`, `12.09.26`) et les deux conventions
décimales (`1 234,56` et `1,234.56`, plus `(123,45)` pour un débit). Le rôle
de chaque colonne se devine sur son **contenu**, pas sur son intitulé :

- une colonne dont huit valeurs sur dix sont des dates est la colonne date ;
- deux colonnes de montants qui se complètent sans jamais se chevaucher sont
  un débit et un crédit séparés — même si le crédit ne compte que six lignes
  sur quarante-huit ;
- une colonne dont les écarts successifs reproduisent une autre colonne est un
  **solde courant**. La prendre pour un montant donnerait un budget entièrement
  faux, et c'est une erreur silencieuse : l'application l'écarte.

**Reconnaître ce qui revient.** Les libellés sont réduits à ce qui les
identifie — mots de service, dates et numéros de carte retirés — puis
regroupés en trois passes, de la plus exacte à la plus large :
« MONOPRIX PARIS » et « MONOPRIX LYON » ne se rejoignent qu'une fois établi
qu'aucun des deux ne tient un rythme tout seul, et une passe large exige
davantage de régularité, faute de quoi elle rapprocherait des dépenses qui
n'ont que leur premier mot en commun.

Le rythme se lit sur l'**écart médian** entre deux opérations, avec une
tolérance qui grandit avec la période — un prélèvement « mensuel » tombe le 3
ou le 5 selon les week-ends. Le montant proposé est la **médiane** : une
facture exceptionnelle ne tire pas la moyenne vers le haut.

**Ce qui ne se répète pas n'est pas jeté** : la somme des opérations isolées
est ramenée à une moyenne mensuelle et proposée comme enveloppe de dépenses
variables. C'est le poste que personne ne pense à saisir, et celui qui fait
mentir toutes les projections.

Une limite à connaître : un relevé de douze mois ne montre qu'une occurrence
d'une charge annuelle, et deux d'une charge trimestrielle. Sous trois
occurrences, l'application ne reconnaît pas un rythme court — elle préfère
ranger ces lignes dans l'enveloppe variable plutôt qu'inventer un bimestriel.

## Confronter la prévision au relevé

C'est la seule boucle de retour de l'application, et ce qui empêche une
projection de décrire, au bout de quelques semaines, un foyer imaginaire.

Chaque compte porte un **solde daté**. Entre ce jour-là et le départ de la
projection, ses échéances ont continué de tomber : elles sont rejouées, pour
ne pas partir d'un chiffre périmé.

**Pointer** un compte consiste à recopier le solde affiché par la banque.
L'application garde à côté ce qu'elle annonçait pour ce jour-là. L'écart entre
les deux — la **dérive** — est la seule mesure honnête de ce que vaut la
prévision. La vue « Suivi » la met en barres, ramenée au mois pour que des
périodes inégales restent comparables, et la commente en euros.

### La marge d'erreur, et ce qu'elle suppose

Au bout de trois pointages, la courbe du tableau de bord porte une marge. Le
modèle est délibérément simple, et c'est ce qui le rend lisible : la dérive de
chaque mois est traitée comme un tirage indépendant, de moyenne `biais` et
d'écart-type `σ`. Sur *t* mois elle s'accumule en moyenne à `biais × t`, et se
disperse en `σ × √t` — la racine, pas *t*, parce que des écarts successifs se
compensent en partie.

Le coefficient 1,28 couvre 80 % des cas **si** les dérives suivent une loi
normale. Elles n'y sont pas tenues : c'est une marge indicative, et
l'application l'annonce comme telle plutôt que de laisser croire à une
garantie. Sous trois mesures, elle ne s'en sert pas et le dit.

Un biais de 69 € par mois paraît négligeable ; sur deux ans il vaut 1 656 €.
C'est précisément ce que la marge sert à montrer.

## Les dix vues

- **Tableau de bord** — solde d'aujourd'hui, solde à l'horizon, reste mensuel,
  reste à vivre ; la courbe de solde jour par jour et sa marge observée ; la
  date de découvert si elle existe, avec le montant qui manque pour tenir la
  période ; les quarante-cinq prochains jours ; où part l'argent ; le partage
  entre dépenses contraintes et choisies ; et **ce que vos chiffres disent**.
- **Revenus & dépenses** — la liste des flux, cherchable et triable, avec pour
  chacun son équivalent mensuel, sa prochaine échéance et son total sur
  l'horizon. Une calculette d'annuité remplit le montant et la dernière
  échéance d'un crédit à partir du capital, du taux et de la durée.
- **Projection** — le détail mois par mois : revenus, dépenses, net, solde de
  fin de mois et point bas du mois. Chaque ligne se déplie sur ses opérations,
  et un sous-total tombe à chaque fin d'année. Exportable en CSV.
- **Calendrier** — le mois au jour le jour : mouvements, solde au soir, jours
  qui passent sous zéro. C'est de là qu'on ajuste une échéance, et qu'on voit
  quelles journées font le point bas du mois.
- **Suivi** — les pointages, la dérive et sa lecture.
- **Catégories** — la répartition, le partage contraint / choisi, et une
  **enveloppe** mensuelle facultative par catégorie.
- **Objectifs** — un montant et une date. L'application lit le solde projeté à
  cette date — en prolongeant la projection au-delà de l'horizon affiché s'il
  le faut, jusqu'à dix ans — et dit ce qu'il manquerait. Un bouton crée le
  virement mensuel qui comblerait l'écart.
- **Scénarios** — « et si ? ». Un scénario retire des flux, en ajoute, applique
  un pourcentage à tous les revenus ou à toutes les dépenses, décale le solde
  de départ — et sa trajectoire se superpose à la référence. Il ne modifie
  jamais vos flux : il les rejoue autrement. **Adopter** un scénario en fait le
  budget de référence en une action, annulable comme les autres.
- **Comptes** — soldes constatés, soldes reportés à aujourd'hui, et à l'horizon.
- **Réglages** — monnaie, horizon, seuil de sécurité, date de départ, thème,
  import/export, sauvegardes automatiques.

### Ce que vos chiffres disent

Onze règles lisent la projection et en tirent des constats : le premier poste
de dépense et sa part, le poids du logement dans les revenus, ce que coûtent
les dépenses choisies, les charges qui tombent en une fois et ce qu'il
faudrait provisionner, le mois le plus chargé, un crédit qui se termine et la
mensualité qu'il libère, ce que l'épargne couvre, le coût des revalorisations,
le jour du mois où tout tombe, l'argent qui ne descend jamais du compte
courant, la dérive mesurée.

Ce sont des **constats, pas des conseils** : chacun porte le chiffre qui le
fonde, pour qu'on puisse le contredire. « Vos abonnements coûtent 805 € par
an » se vérifie ; « résiliez-les » ne regarde que vous. Les seuils cités sont
annoncés pour ce qu'ils sont — le tiers des revenus est une convention de
prêteur, les trois mois d'épargne une recommandation courante.

## Raccourcis

`Ctrl`/`⌘` + `K` ouvre la **palette de commandes** : toute vue, toute création,
toute action, et chacun de vos flux, comptes et scénarios par son nom. La
recherche ignore accents et casse.

`1` … `9` changent de vue, `N` ouvre un nouveau flux, `/` cherche, `C` ramène
au mois en cours, `T` change de thème, `?` affiche l'aide. **Toute
modification est annulable** — par le bouton du message qui la confirme, ou
par `Ctrl`/`⌘` + `Z`, sur trente pas en arrière.

Le calendrier est une grille : un seul arrêt de tabulation, les flèches
circulent, chaque case s'annonce avec sa date, ses opérations et son solde.
La tabulation reste enfermée dans les dialogues, et le focus revient d'où il
venait à leur fermeture.

## Imprimer

Un budget s'imprime — pour un rendez-vous à la banque, pour le mettre au mur.
La page imprimée n'est pas la page à l'écran amputée de son rail : un en-tête
rappelle le budget, la date d'établissement, le solde de départ et l'horizon ;
les commandes et les invitations à cliquer disparaissent ; les en-têtes de
tableau se répètent d'une page à l'autre et aucune ligne n'est coupée en deux.

## Sauvegardes

Six instantanés tournants, au plus un par heure, restaurables depuis les
réglages. Un stockage plein n'empêche pas la sauvegarde principale : les
instantanés cèdent la place. **Cela ne remplace pas l'export JSON** — un
instantané disparaît avec le reste si l'on vide les données du site.

## Ce que la projection ne dit pas

Le solde projeté n'est pas une prévision de ce qui arrivera : c'est la
conséquence arithmétique des flux saisis. Il vaut ce que vaut la saisie — un
abonnement oublié, et la courbe ment de son montant. Trois choses aident à
s'en approcher : partir d'un relevé plutôt que de lister de mémoire ; saisir
les charges annuelles à leur date réelle plutôt que lissées, puisque c'est
précisément ce qui creuse les mois difficiles ; et pointer ses comptes, pour
que l'application mesure son propre écart au lieu de le laisser grandir.

Rien ici n'est un conseil financier.

## Tests

Le moteur — échéances, projection, report de solde, dérive, scénarios,
objectifs, lecture de relevés, détection de rythmes, observations,
sauvegardes, normalisation des données — est couvert par des tests qui
**extraient le script de `index.html`** et l'évaluent hors navigateur. Il n'y
a rien à construire, et c'est bien le code livré qui est testé, pas une copie.

```bash
npm test          # ou : node --test tests/*.test.mjs
```

Aucune dépendance : le lanceur de tests intégré de Node (≥ 18) suffit.

Les parcours d'interface — import d'un relevé, ajustement d'une échéance,
annulation, adoption d'un scénario, navigation au clavier, impression — sont
vérifiés dans un navigateur réel avant chaque livraison.
