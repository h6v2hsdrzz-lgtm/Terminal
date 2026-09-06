# Journal de Joie — Plan de travail, vague 2

> **Ce fichier remplace le `PLAN.md` précédent.** Ce qui a déjà été livré reste en place : on ne refait rien, on améliore.
> Dépose-le à la racine du repo, à côté de `CLAUDE.md` et `ETAT.md`.

---

## 0. Les règles de fonctionnement (inchangées, rappel court)

- **Tu seras coupé en cours de route, plusieurs fois.** `ETAT.md` mis à jour à la fin de **chaque** tâche, avec la prochaine action écrite pour quelqu'un sans contexte. Commit après chaque tâche. Le repo compile toujours.
- **Au début de chaque session** : lire `ETAT.md` puis `CLAUDE.md`, dire en 3 lignes où on en est, reprendre. Pas de re-planification, pas de relecture complète du repo, pas de nouvel audit.
- **Efficacité** : interdiction de refactoriser ce qui marche, pas d'abstraction « au cas où », une seule nouvelle dépendance par lot, explications de 5 lignes maximum, le visible avant la plomberie.
- **iPhone d'abord** : tests Playwright sur **WebKit / iPhone**, safe areas, `100dvh`, champs à 16 px minimum, zones tactiles de 44 px, HEIC converti, `MediaRecorder.isTypeSupported()`, permission des capteurs sur un vrai tap, Wake Lock pendant les parties. Une capture Chromium ne prouve rien.
- **On ne refond pas le design.** Il est bon. Tout ce qui est ajouté se fond dedans.

---

## LOT J — Renommage et nettoyage *(fais-le en premier, c'est 20 minutes)*

**J1.** « Marie Jane » → **« Marie Janne »** partout : interface, déclencheurs, catégories de jeux, paquets de cartes, stats, seed, textes de notification. Migration de libellé, aucune donnée perdue.

**J2. Fil** : supprimer la pastille « C'est posté, vous y êtes tous… ». Elle ne sert à rien une fois qu'on a compris le principe. Le reste du fil ne bouge pas.

---

## LOT K — « Aujourd'hui » : ergonomie et interface

**K1. Les boutons média.** Aujourd'hui c'est « Choisir une photo ou une vidéo » puis « Prendre une photo ». **Inverse l'ordre** — on veut d'abord la caméra — et refais-les en vrais boutons soignés au lieu de lignes de texte :
- deux boutons côte à côte, largeurs égales, hauteur 52 px, coins arrondis comme le reste de l'app ;
- icône + libellé court : **« Photo »** (appareil photo) et **« Galerie »** ;
- état pressé net, retour haptique là où il existe ;
- une fois un média ajouté, les deux boutons se rétractent en une bande de vignettes avec une croix pour retirer.

**K2. Le bouton « Sceller quelque chose ».** C'est le geste signature de l'app, il doit se voir. Bouton pleine largeur, fond légèrement dégradé, icône de sablier dont le sable s'écoule **très lentement** en boucle (2 à 3 secondes par cycle, discret), micro-animation de pression, et ouverture d'une feuille modale qui propose les quatre types : mot, photo, vidéo, audio. C'est le seul endroit de l'écran où tu as le droit d'en faire un peu plus que le reste.

**K3. Remplacer la bulle « La bande » par un graphique.** À la place : **l'évolution du rire et de l'énergie**, une couleur par personne (celle de son profil).
- Deux onglets **Rire** / **Énergie** plutôt que six courbes empilées : trois lignes maximum à l'écran, sinon c'est illisible.
- **Attention, question de conception** : aujourd'hui on ne poste qu'une fois par jour, donc « dans la journée » ne donnerait qu'un point par personne. Ajoute donc le **pouls** : un relevé express (deux curseurs, rire et énergie, deux taps, pas de texte) qu'on peut poser plusieurs fois dans la journée depuis Aujourd'hui. Le check-in complet reste une fois par jour. Le graphique montre alors la journée en cours, heure par heure. **Et s'il n'y a aucun pouls sur la journée, il bascule automatiquement sur les 7 derniers jours** — jamais d'écran vide.
- Points visibles sur chaque relevé, valeur au tap (on est sur mobile, pas de survol), axes discrets, hauteur maximum 200 px, lisible en clair et en sombre, étiquette du prénom au bout de la ligne plutôt qu'une légende.

**K4. Ergonomie générale de l'écran.** Ordre logique des champs, tout tient sans scroll interminable, brouillon sauvegardé en continu, le clavier ne cache jamais le champ en cours, validation en un tap avec un retour visuel franc (et pas juste un texte qui change).

---

## LOT L — Le fil : améliorations *(sans le refondre)*

**L1.** En-tête de date collant en haut pendant le défilement.
**L2.** Pagination infinie vers le bas et bouton « revenir en haut » qui apparaît après deux écrans.
**L3.** Appui long sur une carte = menu rapide : réagir, commenter, partager en image, épingler, retirer.
**L4.** **Partager une journée en image** : une carte 9:16 générée en canvas, dans le style de l'app, à envoyer dans la conversation de groupe.
**L5.** Repère discret « nouveau depuis ta dernière visite ».
**L6.** Filtres rapides en haut : tout / avec photo / avec vocal / par personne.
**L7.** Tirer pour rafraîchir, et arrivée des nouveautés en direct **sans faire sauter le défilement**.

---

## LOT M — Médias et stockage *(c'est là que ça va coincer si on ne le fait pas)*

**M1. Basculer sur Cloudflare R2, pour de vrai.** Palier gratuit de l'ordre de 10 Go et pas de frais de sortie, contre 1 Go chez Supabase. Script de migration des fichiers existants, bascule par variable d'environnement, vérification d'intégrité après migration, et on garde Supabase pour la base et l'authentification.

**M2. Deux tailles par image**, jamais plus : une miniature 320 px pour le fil, un affichage 1600 px pour le plein écran. L'original est converti puis jeté (ou gardé 7 jours puis purgé automatiquement).

**M3. Formats** : conversion **HEIC → WebP côté client** (les photos d'iPhone sont en HEIC), AVIF quand c'est supporté, correction de l'orientation EXIF.

**M4. Réglages → Stockage** : jauge d'occupation, répartition par personne et par type, et un bouton « libérer de la place » qui propose les plus gros fichiers et les doublons.

**M5. Upload en arrière-plan** : file d'attente, reprise après coupure réseau, progression visible mais non bloquante — on doit pouvoir continuer à écrire pendant que ça monte.

**M6. Visionneuse plein écran** (si ce n'est pas déjà au niveau) : pincer pour zoomer, double-tap, balayer pour changer de photo, balayer vers le bas pour fermer, préchargement des voisines, flou progressif pendant le chargement, compteur de position, double-tap = réaction.

---

## LOT N — Les jeux : chacun sur son téléphone *(refonte du moteur, priorité haute)*

On sera tous les trois avec l'app installée. **Se passer le téléphone, c'est fini.**

**N1.** Le mode **multi-téléphones devient le mode par défaut**. Le mode « un seul téléphone » reste disponible en option pour dépanner.

**N2. Le salon de partie.** L'hôte lance une partie, les deux autres reçoivent une notification et voient un bandeau « rejoindre » en haut de l'accueil. Code à 4 chiffres en secours. Liste des joueurs connectés en temps réel, l'hôte lance quand tout le monde est là.

**N3. Machine à états côté serveur** : tables `parties`, `manches`, `actions_joueurs`. L'état de la partie vit sur le serveur, jamais dans le téléphone d'un seul joueur. Synchronisation Realtime, et **l'écran affiché dépend du rôle du joueur dans la manche en cours** — c'est tout l'intérêt du multi-téléphones.

**N4. Robustesse** : reconnexion automatique, reprise après verrouillage de l'écran, gestion d'un joueur qui quitte ou qui perd le réseau, délai maximum par manche, transfert d'hôte si l'hôte s'en va. Une partie ne doit jamais se retrouver bloquée sans issue.

**N5.** Wake Lock actif toute la partie, bandeau de classement discret en haut, podium animé à la fin, conversion des points en points d'app.

**N6. Latence** : actions optimistes à l'écran, mais **horloge serveur** pour tout ce qui mesure de la vitesse, sinon celui avec la meilleure 4G gagne toujours.

---

## LOT O — Les jeux : contenu et qualité

**O1. « Devine qui je suis » : ajoute les photos.**
- Chaque carte affiche une **image de bonne qualité** en plein cadre, avec un dégradé sombre en bas et le nom en très gros par-dessus. Souviens-toi que celui qui porte le téléphone ne voit rien : **la carte doit être lisible à deux mètres** par les deux autres. Nom en 48 px minimum, image nette.
- **Source des images** : l'API Wikipédia (`https://fr.wikipedia.org/api/rest_v1/page/summary/<titre>`) renvoie une vignette et sa licence, gratuitement et sans clé. Écris un script de construction des paquets qui récupère l'image de chaque carte, vérifie qu'elle correspond bien, et stocke l'URL et l'attribution en base. Crédit discret en bas de carte. Repli propre sur une carte texte quand il n'y a pas d'image.
- **En multi-téléphones** : le porteur voit la carte, **les deux autres voient un écran « fais deviner » avec les boutons Trouvé et Passer**. Plus besoin d'incliner quoi que ce soit — c'est plus fiable et plus rapide. Garde l'inclinaison en option pour le mode un seul téléphone.

**O2. Le niveau : hardcore, sur tous les jeux.** Voir la section dédiée plus bas, c'est la partie la plus importante de ce lot.

**O3. « Le plus rapide » : ergonomie et interface à refaire.**
- Zone de tap **plein écran**, pas un petit bouton au milieu.
- Décompte 3-2-1, puis **délai aléatoire de 1 à 5 secondes** avant le signal, sinon on anticipe.
- Détection des faux départs, avec une manche perdue à la clé.
- Temps de réaction affiché **en très gros, en millisecondes**, avec l'écart par rapport aux deux autres.
- Format best-of-5, podium animé, haptique là où elle existe.
- Deux modes : **duel** (deux joueurs, le troisième arbitre) et **les trois en même temps**.
- En multi-téléphones, le signal part du serveur au même instant pour tout le monde.

**O4. Trois nouveaux jeux Marie Janne** (détaillés plus bas).

**O5. Qualité avant quantité.** Chaque jeu doit avoir : une fiche de règles lisible **avant** le lancement, un état de chargement, un écran de fin, et être jouable de bout en bout sans bug à trois téléphones. **Mieux vaut dix jeux impeccables que trente-cinq à moitié.** Si certains des jeux existants sont bancals, dis-le et propose d'en supprimer plutôt que d'en empiler.

### Les trois nouveaux jeux Marie Janne

Peu de texte à lire, rythme lent, et surtout : ils doivent produire quelque chose de drôle à réécouter le lendemain.

**36. Le mot de passe.** L'app donne discrètement un mot improbable à chaque joueur. Il faut le placer dans la conversation sans se faire griller. Chacun a un bouton « je te grille » : si tu grilles le bon mot, tu marques ; si tu te trompes, tu perds des points. La manche dure toute la session, en arrière-plan des autres jeux.

**37. La théorie du complot.** L'app tire deux éléments sans aucun rapport (« les pigeons » + « les bornes de recharge »). Le joueur a 90 secondes pour bâtir la théorie la plus convaincante, **enregistrée en audio**. Les deux autres notent sur 10. L'enregistrement part dans les souvenirs.

**38. Le tribunal des idées.** Chacun défend son idée de business ou d'invention en 60 secondes chrono, enregistrée. Les deux autres votent. **Le lendemain matin, l'app te renvoie ton propre audio en notification** pour que tu réalises ce que tu as dit. C'est le principe du jeu.

---

## LOT P — Profil : les deux graphiques

**P1. Dans « Tes points », sous le nombre de parties jouées** : le graphique d'**évolution du classement général**.
- Une ligne par joueur, dans sa couleur de profil.
- Sur l'axe vertical, les **points cumulés** (plus lisible qu'un rang qui saute), avec un petit encart à côté qui affiche la position actuelle de chacun : « 1er · Sam · 2 340 pts ».
- Périodes 30 jours / 90 jours / tout.
- Valeur au tap, prénom en bout de ligne, pas de légende encombrante.

**P2. Remplacer « Assiduité de la semaine »** par le graphique des **déclencheurs dans le temps**.
- Trois séries : **biberon**, **Marie Janne**, **sport**. Nombre d'occurrences par semaine.
- Choisis des couleurs **distinctes des couleurs de personnes**, sinon on confondra les deux graphiques de la page.
- À côté ou en dessous, la **note moyenne des journées où chaque déclencheur était présent**, en trois pastilles compactes : « biberon 7,8 · Marie Janne 8,1 · sport 7,2 ».
- Et sois honnête : sous 5 journées pour un déclencheur, affiche un tiret et « pas assez de données » plutôt qu'une moyenne qui ne veut rien dire.

**P3. Règles communes aux graphiques de l'app** (applique-les aux trois) : la couleur d'une personne est la même partout ; jamais plus de trois lignes à l'écran ; courbes légèrement lissées ; axes discrets, pas de grille lourde ; chiffres en chasse fixe ; valeur au tap, jamais au survol ; hauteur maximum 200 px ; état vide dessiné avec soin ; lisible en clair **et** en sombre.

---

## LOT Q — Ce que j'ajoute parce que ça manque

**Q1.** Un écran de réglages complet : notifications par type, thème, confidentialité, stockage, gestion de la bande, déconnexion.
**Q2.** Gestion des erreurs et de l'état hors-ligne **visible** : bandeau clair, bouton réessayer, rien qui échoue en silence.
**Q3.** Liens profonds : une notification ouvre directement la bonne journée, la bonne photo ou la bonne partie.
**Q4.** Sauvegarde et export complet (JSON + CSV + médias), et l'import qui va avec.
**Q5.** Recherche globale si elle n'existe toujours pas.
**Q6.** Performance : Lighthouse mobile ≥ 90, images servies à la bonne taille, listes virtualisées au-delà de 100 éléments, aucun décalage de mise en page.
**Q7.** Un écran **« Nouveautés »** court à chaque mise à jour. Personne ne lit un changelog, mais tout le monde regarde trois écrans qui défilent.

---

## LOT R — Les audits *(à la fin)*

**Audit 1 — Fonctionnel.** Reprends ce fichier point par point, rends un tableau fait / partiel / pas fait, une ligne d'explication pour tout ce qui n'est pas « fait ».
**Audit 2 — Visuel.** Capture WebKit iPhone de chaque écran et de chaque état (vide, chargement, erreur, beaucoup de données). Regarde-les vraiment, corrige, montre-moi avant / après.
**Audit 3 — Parcours réel à trois téléphones.** Une partie complète de chaque jeu, un check-in, un pouls, un upload de photo coupé en plein réseau, une reconnexion en cours de partie, une notification qui ouvre le bon écran.

---

## Le registre : hardcore, et pas tiède

C'est le point sur lequel la dernière livraison est passée à côté. Ce qui a été écrit ressemble à un jeu à boire de séminaire d'entreprise. On est trois potes adultes, entre nous, et personne ne joue à ça pour lire « je n'ai jamais séché un cours ».

Concrètement, pour **tous** les jeux :

- **Vocabulaire cru et argot.** Le ton d'un pote à 2 h du matin, pas d'un animateur de colonie. Pas d'euphémisme, pas de formulation prudente.
- **Trois niveaux réellement différents.** Le niveau 3 doit être gênant à lire à voix haute : confessions sexuelles explicites, hontes intégrales, ce qu'on n'avoue pas sobre, gros ratés, humour noir sur la mort, les ex, les accidents, les échecs. Le niveau 1 doit déjà être plus salé que ce qu'il y a aujourd'hui.
- **Le volume compte** : au moins **400 cartes** pour « Je n'ai jamais », **200** pour « Tu préfères », et la même montée en intensité sur les gages, les défis, les questions, et les paquets de « Devine qui je suis » (figures sulfureuses comprises).
- **La bande peut ajouter ses propres cartes** et les partager entre les trois. C'est là que ça devient vraiment personnel, et c'est probablement le plus drôle sur la durée.

Deux limites, et elles ne bougent pas parce qu'elles ne rendent rien plus drôle :

1. **rien qui vise un groupe pour ce qu'il est** (origine, religion, orientation, handicap) — ça, ce n'est pas du hardcore, c'est du contenu haineux, et ça transforme une soirée en malaise ;
2. **rien de sexuel impliquant des mineurs**, et rien qui vise une personne réelle extérieure à la bande.

Tout le reste est ouvert. En cas d'hésitation sur une carte, va plus loin plutôt que moins.

Et les garde-fous des jeux à boire restent en place, parce qu'ils ne coûtent rien : l'unité est la gorgée, aucun jeu ne demande de boire vite ou en quantité, le bouton « je passe » est toujours là, et un joueur peut se marquer sobre s'il conduit.

---

## Avant de commencer

1. Lis `ETAT.md` et `CLAUDE.md`, puis dis-moi en 10 lignes maximum ce qui, dans ce plan, est déjà couvert par ce qui a été livré.
2. Pose-moi au maximum **cinq questions**, uniquement celles dont la réponse change ton plan.
3. Propose le découpage du **lot J et du lot K seulement**, en tâches de 40 minutes maximum, et attends mon feu vert.

Si une idée de ce document est mauvaise ou coûteuse pour rien, dis-le et propose mieux.
