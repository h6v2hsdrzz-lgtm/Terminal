# Journal des versions

Les entrées vont de la plus récente à la plus ancienne. Chaque lot du chantier
v3 y ajoute une section ; les jalons v2 sont regroupés en tête d'historique.

## Lot Q — Réglages, notifications et le reste

### Les notifications poussées
- **Écrites à la main**, sans dépendance : ECDH P-256 + HKDF + AES-128-GCM
  (RFC 8291), l'encodage `aes128gcm` (RFC 8188) et le jeton VAPID ES256
  (RFC 8292), avec `node:crypto` et rien d'autre. Les tests vérifient les six
  intermédiaires publiés par le RFC, puis déchiffrent pour de bon.
- **Six types**, réglables un par un : une journée posée, un commentaire, une
  réaction, une partie qui s'ouvre, un scellé qui s'ouvre, sa propre voix le
  lendemain. Tout est allumé **sauf les réactions** — un petit cœur n'appelle
  pas de réponse, et une notification par cœur transforme un geste léger en
  interruption.
- L'appareil et la personne sont deux réglages distincts : recevoir sur son
  téléphone et pas sur l'ordinateur du bureau, mais choisir une bonne fois pour
  toutes ce qu'on veut recevoir.
- Deux notifications de même **étiquette** se remplacent au lieu de s'empiler :
  trois commentaires sur la même journée font une ligne, pas trois.
- **Un lien profond** dans chacune : on la touche, on est dans la partie, pas
  sur l'accueil. Et si l'application est déjà ouverte, elle y va sans ouvrir un
  deuxième onglet.
- Rien n'est cassé sans les clés : l'écran de réglages le dit, et le reste
  tourne.

### Rien n'échoue en silence
- Un **bandeau unique** dit les trois choses qui peuvent mal se passer : hors
  ligne (ce n'est pas une erreur, c'est un tunnel), de retour (trois secondes,
  puis ça se tait), et **un geste qui n'est pas passé** — avec un bouton qui
  refait exactement ce qui a raté.
- Sept appels jetaient l'erreur que le serveur leur rendait : une réaction, une
  épingle, un commentaire supprimé, un scellé retiré, un départ de salon, une
  réponse de jeu, une manche publiée — et **le retrait d'une journée**, qui est
  la règle numéro un du produit.
- Une réaction affichée avant la réponse du serveur est reprise si le serveur
  refuse. Un cœur qui reste affiché sur un geste qui n'a pas eu lieu est un
  mensonge.

### Chercher
- Un écran, une loupe en haut du fil. Les journées, les titres, les
  commentaires, les légendes des photos, les lieux.
- **Les accents et la casse ne comptent pas** — « ete » trouve « été » — et
  plusieurs mots se cherchent dans n'importe quel ordre, y compris répartis
  entre le titre et le lieu.
- Le mot trouvé est **surligné**, dans le titre comme dans l'extrait, et
  l'extrait est recadré autour de lui.
- **Le voile s'applique à la recherche**, et il exclut au lieu de vider : dire
  « il y a ce mot dans la journée que tu n'as pas le droit de lire » serait
  exactement ce que le voile existe pour empêcher.

### L'écran d'une journée
- `/jour/2026-09-11` : la journée de toute la bande, seule. C'est là que mènent
  les résultats de recherche et les notifications — faire défiler le fil
  jusqu'au 14 mars n'est pas un résultat de recherche.

### Emporter, et remettre en place
- La **sauvegarde complète** (.zip) emporte enfin ce qui manquait : les photos,
  les vidéos et les vocaux, avec le JSON, le tableur et un fichier qui explique
  quoi en faire. Un export qui annonce « 3 photos » sans les photos est un
  inventaire, et un inventaire ne ramène rien.
- Et **la restauration qui va avec** : on redonne le .zip (ou un vieux .json),
  et tout revient. **Rien n'est écrasé** — une journée déjà là reste exactement
  comme elle est, et le rapport dit combien de journées, de photos et de
  commentaires sont revenus.
- Un pseudo de la sauvegarde qui ne correspond à personne est **dit**, pas
  deviné : attribuer les journées de quelqu'un à quelqu'un d'autre serait pire
  que de ne rien restaurer.

### Ce qui a changé
- Cinq écrans qui défilent à la première ouverture après une mise à jour, et
  plus jamais ensuite. Ils se revoient depuis les réglages.

### La galerie ne s'écroule plus
- « Tout voir » posait tout d'un coup : sur trois ans de bande, quelques
  milliers de cases, un téléphone bloqué plusieurs secondes. Le lien ajoute
  maintenant **une page de cent vingt**, comme le fil — et une adresse tapée à
  la main ne redevient pas « tout charger ».

### Le réveil du matin
- Deux dettes payées, et elles attendaient la même chose : **un scellé qui
  s'ouvre** prévient enfin la bande (elle attendait depuis la vague 1), et le
  **plaidoyer du « Tribunal des idées »** revient chez son auteur le lendemain
  matin — c'est le principe du jeu, pas une option.
- Une fois par jour, appelé par Vercel et par personne d'autre : sans le secret,
  la route refuse. Et sans secret posé du tout, elle refuse aussi — un secret
  oublié doit couper la fonction, pas la garde.
- Rejouable : chaque chose envoyée est marquée après coup, donc deux passages
  dans la même matinée n'envoient rien deux fois.

### L'apparence
- Clair, sombre, ou celui du téléphone. Le réglage reste sur l'appareil et ne
  traverse jamais le réseau — le même compte sur une table de nuit et en plein
  jour n'a pas la même bonne réponse.
- Posé par un script **avant le premier pixel** : sans lui, la page s'affiche
  dans le thème du système puis bascule. Un éclair blanc à minuit range une
  application dans les choses qui font mal aux yeux.

### Se déconnecter
- Le geste le plus banal d'une application et le plus dangereux de celle-ci :
  sans mot de passe, le code de reprise est la seule porte de retour. On le dit
  **avant**, pas après.

## Lot P — Deux graphiques dans le profil

### L'évolution du classement
- Une ligne par personne, dans sa couleur — la même qu'ailleurs dans
  l'application.
- Les **points cumulés** et pas le rang : un rang saute d'un cran pour un point
  d'écart et donne à un coude à coude l'allure d'un renversement.
- Trente jours, quatre-vingt-dix jours, ou tout. Changer de fenêtre ne remet
  personne à zéro : les lignes partent de ce que chacun avait déjà.
- Le prénom en bout de ligne, le classement en dessous, et la valeur d'un jour
  **au toucher**.

### Les déclencheurs dans le temps
- Il remplace « la semaine ». Biberon, Marie Janne, sport : le nombre de fois
  par semaine — ou par mois quand la fenêtre dépasse six mois, sinon les barres
  font un pixel.
- Des **couleurs qui n'appartiennent à personne**, pour qu'on ne confonde pas ce
  graphique avec celui du dessus.
- Et la note moyenne des journées où chacun était là, en trois pastilles. **Sous
  cinq journées, un tiret** : « 8,4 sur deux journées » a l'air d'un résultat et
  n'en est pas un.

### Partout
- Les trois graphiques de l'application rendent leur valeur **au toucher** — un
  téléphone n'a pas de survol — tiennent sous deux cents pixels de haut, et se
  lisent en clair comme en sombre.

## Lot O — Des photos sur les cartes, et trois jeux de plus

### « Devine qui je suis » : des visages
- Chaque carte affiche une **photo en plein cadre** quand il en existe une :
  dégradé sombre en bas, nom en très gros par-dessus, crédit discret en pied.
  Ça se lit à deux mètres, ce qui est toute la question quand le téléphone est
  sur un front.
- 237 cartes sur 494 en ont une. Les autres se jouent en texte, exactement comme
  avant — « Un carton rouge » n'a pas de portrait, et n'en a pas besoin.
- Les images viennent de Wikipédia, avec leur auteur et leur licence. **Elles
  passent par nos routes** : le téléphone de la bande ne dit à personne ce qu'il
  est en train de jouer.

### « Le plus rapide », refait
- Décompte **3-2-1**, puis un délai imprévisible d'une à cinq secondes : on ne
  part plus sur le « 1 ».
- Zone de tap **plein écran**, vibration à l'appui.
- Le temps de réaction **en millisecondes, en très gros**, avec l'écart au
  premier. C'est le résultat du jeu, plus une note de bas de page.
- Tournoi en **cinq manches**, puis podium — il s'arrête tout seul.
- **Mode duel** : deux joueurs s'affrontent, le troisième arbitre et voit les
  deux temps. Les duellistes tournent d'une manche à l'autre.
- Un départ brûlé ne prend plus de rang au classement : il ne court pas.

### Trois jeux de Marie Janne
- **Le mot de passe.** Chacun reçoit un mot improbable à placer dans la
  conversation. « Je te grille » : juste, tu marques ; à côté, tu perds un
  point. Il tourne **en arrière-plan** — on le lance, on pose le téléphone, et
  on joue à autre chose pendant ce temps-là.
- **La théorie du complot.** Deux choses sans aucun rapport, quatre-vingt-dix
  secondes enregistrées pour les relier, et les deux autres notent sur dix.
- **Le tribunal des idées.** Soixante secondes chrono pour défendre une
  invention, enregistrées. Les deux autres décident si ça se finance.
- Les enregistrements **partent dans les souvenirs** : c'est là qu'ils servent
  vraiment, le mardi suivant, quand personne ne s'y attend.

## Lot N — Les dix jeux, chacun sur son téléphone

Le mode « on se le passe » reste là pour dépanner une batterie à plat. Mais par
défaut, maintenant, chacun joue sur son écran — et l'écran n'est plus le même
pour tout le monde.

### Le salon
- L'hôte choisit un jeu et ouvre un salon. Les deux autres voient un bandeau en
  haut de leur accueil, ou tapent le **code à quatre chiffres** dicté à voix
  haute — quatre chiffres traversent une cuisine, un lien non.
- La liste des joueurs s'allume en direct, un point par personne présente.
  L'hôte lance quand tout le monde est là ; personne ne lance à sa place.
- Un salon oublié depuis la veille se ferme tout seul à l'ouverture du suivant.

### Ce que le multi change aux jeux
- **« Devine qui je suis » n'a plus besoin d'un téléphone sur le front** : le mot
  s'affiche chez les deux autres, et celui qui devine regarde son propre écran
  comme tout le monde.
- **« Menteur »** : l'acteur écrit ses trois affirmations chez lui, personne ne
  lit par-dessus son épaule ; les deux autres cherchent la fausse sans voir le
  vote du voisin, et le menteur les regarde chercher.
- **« Le jugement »** : chacun répond de son côté, et le juge voit les réponses
  arriver sans savoir qui a écrit quoi avant de trancher.
- **« Le plus rapide »** est enfin honnête. Le serveur annonce **à l'avance**
  l'instant du signal ; chaque téléphone compte à rebours chez lui, et c'est
  l'horodatage du serveur qui départage. Celui qui a la meilleure 4G ne gagne
  plus. Appuyer avant le vert fait boire, et ne peut plus faire gagner.
- Les dix jeux, pas six : les trois archétypes (vote, tour, réflexe) les
  couvrent tous, et un jeu du catalogue sans règle jouable à plusieurs fait
  rougir un test. Les quatre formes d'écran sont jouées pour de vrai à deux
  téléphones dans la suite de tests — c'est comme ça qu'on a découvert que deux
  des dix ne se jouaient pas du tout.

### Quand ça va mal
- Reconnexion automatique, reprise après verrouillage d'écran, et un délai
  maximum par manche pour qu'un téléphone éteint ne bloque personne.
- **Si l'hôte s'en va, quelqu'un d'autre reprend la main** — au bout de vingt
  secondes sans signe de vie, et pas avant : ce n'est pas un bouton de confort.
- Une partie ne reste jamais sans issue.

### Le reste
- L'écran reste éveillé du salon à la fin de la partie.
- Barre de score discrète en haut, avec un anneau sur celui dont c'est le tour ;
  podium animé à la fin, et les points convertis en points d'application.

> Les lots J, K, L, M et O2 de la vague 2 (le geste, la journée, le fil, les
> médias, le registre de cartes) sont livrés mais n'ont pas de section ici :
> `ETAT.md` en tient le compte détaillé.

## Lot G — Les jeux

Dix jeux, à trois, sur un seul téléphone qu'on se passe.

### Le moteur
- Un onglet **Jeux**, quatre catégories, une fiche par jeu avec ses règles en
  trois lignes — **lisibles avant de lancer**, jamais pendant.
- Une partie à la fois par bande, reprise possible, abandon confirmé.
- Barre de score discrète et permanente, podium animé, conversion en points
  d'application. L'écran reste allumé pendant la partie ; un rappel d'eau
  apparaît toutes les trente minutes.
- Pas de barre d'onglets pendant une partie : « Fil » sous le pouce, et la
  partie s'interrompt toutes les cinq minutes.

### Le cadre, dans le moteur
- L'unité est **la gorgée**, jamais le verre. Trois au maximum par manche.
- **« Je passe » est toujours là et ne coûte rien** — ni gage de remplacement,
  ni remarque.
- Celui qui **conduit** est marqué sobre et reçoit un gage à la place.
- L'application ne compte aucune consommation : un compteur transforme la
  soirée en score, et le score en défi.

### Les dix jeux
Devine qui je suis (douze paquets, plus de cinq cents cartes, une roulette, et
« Nos potes » que la bande écrit) · Je n'ai jamais · Tu préfères · Qui est le
plus susceptible de · Le jugement · Menteur · Top 3 · Le plus rapide · Le quiz
de la bande · Devine qui a écrit ça.

Les deux derniers se nourrissent du journal : aucun autre groupe ne peut les
avoir. Le quiz ne demande **jamais** qui va bien — une question posée devient
un classement énoncé — et ne pose pas de question dont il n'a pas la réponse.

### Écarts au plan, assumés
- **Un seul mode**, « un seul téléphone ». « Chacun son téléphone » supposait
  du temps réel ; ici la synchronisation est un sondage, avec une à trois
  secondes de retard — invisible dans le fil, désastreux sur un vote simultané.
- **Les jeux ont leur propre plafond quotidien** (120 points), que le plan
  n'avait pas prévu : sans lui, une soirée valait sept journées parfaites.

### Ajouté au passage
- Une page **404** et un écran **d'erreur** en français. Sans eux, Next servait
  les siens, en anglais, dans une application annoncée 100 % en français.

## Lot F — Le lieu

### Ajouté
- **« Utiliser ma position »** dans le champ Lieu du check-in. La permission
  est demandée par le geste, jamais au chargement, et le champ reste libre si
  elle est refusée.
- **Une constellation des lieux** dans les souvenirs, dès que deux lieux ont
  une position.

### Ce qui ne sort pas
- **La position part du serveur, pas du téléphone.** Interroger OpenStreetMap
  depuis le navigateur enverrait la position de quelqu'un, avec son adresse IP,
  à un service tiers. Ici le tiers ne voit que notre serveur, avec un
  `User-Agent` identifiable et un cache, comme sa politique d'usage le demande.
- **La position est arrondie AVANT d'être envoyée et avant d'être stockée** :
  deux décimales, environ un kilomètre. Assez pour reconnaître un quartier, pas
  pour trouver une porte. Ce qui n'est pas envoyé ne peut pas fuir, et arrondir
  à l'affichage aurait laissé la précision en base.
- **Pas de fond de carte.** Le plan demandait Leaflet et des tuiles
  OpenStreetMap ; chaque tuile est une requête vers un serveur tiers, et la
  suite des tuiles demandées dit où sont vos souvenirs et lesquels vous
  regardez. La constellation est un SVG : aucune dépendance, aucune requête, et
  un test échoue si une requête sort vers un autre hôte.

### Corrigé avant livraison
- **La constellation était illisible.** En projection linéaire, un lieu à
  Nantes fixe l'échelle et les cinq lieux parisiens s'écrasent en une tache
  avec cinq étiquettes empilées — la capture l'a montré, aucun test unitaire ne
  l'aurait vu. Le placement mélange maintenant le linéaire et le rang, et les
  étiquettes se poussent les unes les autres au lieu de se superposer.

## Lot A — Renommages et profil

Premier lot du plan de travail (`PLAN.md`), qui entre au dépôt avec `ETAT.md`
et `CLAUDE.md`.

### Renommé
- **« Plante verte » devient « Marie Jane ».** Une migration `UPDATE`, pas une
  recréation : la ligne garde son identifiant, donc les 496 journées qui la
  portaient restent cochées et les statistiques d'effet gardent leur
  historique. Un `DELETE` suivi d'un `INSERT` aurait emporté la table de
  liaison par cascade.
- « Ce qui a fait la journée » devient **l'anecdote**.
- « Étiquettes » devient **Lieu**, dans le champ et dans l'export.

### Ajouté
- **On change son nom** depuis le profil. Comme le pseudo n'est recopié dans
  aucune journée, le passé change avec — on ne relit pas ses souvenirs sous un
  nom qu'on n'a plus.
- **Une photo de profil**, recadrée au doigt dans une fenêtre ronde. Ce qui
  part au serveur est un carré de 256 pixels ; l'originale ferait stocker
  quatre méga-octets pour un rond de quarante.
- **« Toi, en petit »** : les dix derniers médias de la personne, et quatre
  traits — l'heure à laquelle elle pose sa journée, le lieu qui revient, la
  part de vocaux, le mot qui revient. Chacun se tait quand il n'y a pas de quoi
  le dire.

### Déplacé
- **Le fil est la première chose qu'on voit** en ouvrant l'application. Le
  check-in a sa propre adresse, `/aujourdhui`, et une carte d'appel en tête du
  fil y mène — avec la figure du jour dedans.
- **Le fil porte le voile.** Il ne l'avait pas : il affichait tout en clair. En
  faire la page d'ouverture sans y porter le voile aurait suffi à casser la
  mécanique du produit — ouvrir l'application aurait donné à lire tout le
  monde, et personne n'aurait plus écrit ce qu'il pense vraiment. Seule la
  journée en cours est masquée ; le passé reste lisible.
- « Calme » devient **« rire »**. La colonne garde son nom : l'échelle est la
  même, et renommer une colonne pour un mot d'écran serait une migration
  risquée sans rien de visible.

### Retiré
- **Les trois compteurs du profil** — « jours d'affilée », « ton record »,
  « journées posées ». Un journal n'est pas un tableau de performance, et
  c'était la seule chose de l'écran qui donnait envie de poster pour le
  compteur plutôt que pour la journée.

### Corrigé
- **Un changement de nom ou de photo n'arrivait jamais chez les autres.** Il ne
  touche à aucune journée, donc l'empreinte de synchronisation ne bougeait pas.
  `Membre.modifieLe` y entre — même défaut que les photos et les notes vocales
  avaient eu, même correction.
- **`chargerContexte` chargeait les octets de chaque avatar à chaque page.**
  Un `include` tire toutes les colonnes ; sur un champ `Bytes`, ça se compte en
  méga-octets par navigation. Sélection explicite, et la présence d'une photo
  se demande à part.
- **Une entrée vidée n'est pas une entrée cachée.** Le voile met la joie à
  zéro ; sans le dire à la carte, l'écran affichait un gros « 0 » et « 0,0 de
  moyenne ». Ça ne cachait rien et laissait croire à une journée épouvantable.
- La base de démonstration disait « le plus souvent repos ». Ce n'est pas un
  lieu, et le champ s'appelle « Lieu » : les données doivent dire la même chose
  que l'interface.

### Une précision d'architecture
`PLAN.md` a été écrit en supposant **Supabase**, qui n'est pas la pile de ce
dépôt. Les garanties sont tenues autrement et la traduction terme à terme est
dans `CLAUDE.md` : la RLS devient l'autorisation côté serveur, les buckets
privés deviennent des routes qui exigent une session, Realtime devient le
sondage d'une empreinte de version.

## Lot 2 — La vidéo, et la partie photo devenue un vrai album

### Ajouté
- **La vidéo.** Jusqu'à huit secondes par média, réencodée **dans le
  navigateur** avant l'envoi : 720 pixels de côté long, H.264, débit calculé
  d'après le nombre de pixels. Une vidéo d'iPhone de huit secondes pèse une
  quinzaine de méga-octets et retombe autour du méga-octet — l'ordre de grandeur
  d'une photo. Ce n'est pas une optimisation : c'est ce qui rend la vidéo
  possible sur une base gratuite d'un demi-giga-octet.
- **Des vignettes** pour chaque média, fabriquées dans le navigateur. Le fil et
  la galerie ne servent plus que celles-là. Avant, une case de cent soixante
  pixels tirait une image de mille quatre cents — et pour une vidéo, le fichier
  entier.
- **La galerie** : tout ce que la bande a posté, en mosaïque, groupé par mois,
  avec un liseré de la couleur de chacun et le plein écran qui défile d'un média
  à l'autre. On y entre depuis les souvenirs — cinq onglets remplissent déjà la
  largeur d'un iPhone.
- **Des légendes** sous les photos et les vidéos, à poser et à corriger après
  coup.
- **Six médias par journée** au lieu de quatre, photos et vidéos mêlées.
- Dans le fil, une vidéo se lit **muette, en boucle, et seulement quand on la
  regarde** — le son n'arrive qu'en plein écran, qu'on a ouvert exprès.
- **La place occupée**, dans les réglages, avec le plafond de l'hébergement
  gratuit. Cette application ne coûte rien, et ce n'est pas gratuit par magie ;
  le dire vaut mieux qu'un refus d'envoi le jour où la base est pleine.
- Le mur des souvenirs retient désormais **les vidéos et les notes vocales**.
  Une journée où quelqu'un a filmé ou parlé en est un.

### Ce que la sonde du moteur a montré
- **Le WebKit de Playwright n'a pas `MediaRecorder`** — pas même pour l'audio.
  Ce n'est pas Safari sur iPhone, c'est une compilation Linux de WebKit. En
  revanche il a **WebCodecs au complet** : H.264, AAC, Opus. Le réencodage passe
  donc par `VideoEncoder`, qui est aussi la seule voie laissant choisir la
  résolution *et* le débit — `MediaRecorder` suit la cadence de lecture et ne
  garantit aucune taille.
- Sonder avant d'écrire a évité de construire tout le lot sur une API absente
  du seul moteur où l'on peut le vérifier.

### Corrigé pendant le chantier
- **Le transcodage ne se terminait jamais.** La première version capturait les
  images en laissant la vidéo jouer, via `requestVideoFrameCallback`. Ça dépend
  du compositeur : un élément `<video>` qui n'est pas dans le document n'est
  peint par personne, aucune image n'arrive, et l'écran reste sur « Envoi… »
  indéfiniment. Les images sont maintenant prises en déplaçant le curseur — ça
  ne dépend que du décodeur, et ce n'est pas tenu par le temps réel : huit
  secondes de vidéo ne prennent plus huit secondes.
- **Chaque déplacement est borné dans le temps.** Un déplacement qui n'aboutit
  pas n'émet jamais son événement ; sans délai, on réintroduisait le blocage
  qu'on venait de corriger.
- **La présence d'une note vocale à l'écran tenait au hasard.** Le mur ne les
  comptait pas, et le peuplement n'en garantissait aucune : le test qui allait
  la chercher passait une fois sur deux. Le mur les compte, et la base de
  démonstration en garantit trois sur les dix derniers jours.

### Deux défauts qui ne se voyaient pas encore
- **L'aperçu des souvenirs chargeait tous les médias de la bande pour en
  montrer huit.** Invisible la première année, c'est une page qui ne charge plus
  la cinquième.
- **La galerie n'avait aucune borne.** Elle en affiche cent vingt, et le reste
  tient dans un lien — un vrai lien, qui marche sans JavaScript et se partage.

### Le schéma
La table des photos gagne quatre colonnes — `genre`, `vignette`, `duree`,
`legende` — et **garde son nom**. Le modèle Prisma, lui, s'appelle désormais
`Media`. Prisma ne sait pas reconnaître un renommage de table : il produirait un
`DROP TABLE` suivi d'un `CREATE`, c'est-à-dire la perte de toutes les photos
déjà en ligne. Un nom de table un peu daté coûte moins cher.

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
