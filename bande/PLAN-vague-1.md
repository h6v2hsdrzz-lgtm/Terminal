# Journal de Joie — Plan de travail

> **Ce fichier est la source de vérité du projet.** Tu le lis au début de chaque session, avant toute autre chose.
> Le budget est limité et tu seras coupé en cours de route, plusieurs fois. Tout ce plan est conçu pour que ça n'ait aucune importance : petites tâches, commit à chaque tâche, état écrit sur disque.

---

# PARTIE 0 — Les règles du jeu

## 0.1 Tu vas être coupé, prépare-toi pour

C'est la règle la plus importante du document.

1. **Crée `ETAT.md` à la racine** dès la première session, et mets-le à jour **à la fin de chaque tâche**, jamais plus tard. Il contient, dans cet ordre :
   - le lot en cours et la tâche en cours ;
   - la liste des tâches terminées (une ligne chacune) ;
   - **la prochaine action exacte**, écrite pour quelqu'un qui n'a aucun contexte ;
   - les décisions prises et pourquoi ;
   - les pièges rencontrés, pour ne pas les redécouvrir.
2. **Crée `CLAUDE.md` à la racine** : architecture du projet, conventions de code, structure des dossiers, commandes utiles, schéma de la base. C'est ce qui t'évitera de relire tout le repo à chaque session. Tiens-le à jour quand l'architecture bouge.
3. **Commit après chaque tâche**, message du type `lot A2 : le fil devient la page d'accueil`. Jamais plus de 40 minutes de travail non commité.
4. **Le repo doit toujours compiler et se déployer.** Ne commence jamais une tâche que tu ne peux pas finir dans la foulée : si elle est trop grosse, coupe-la en deux avant de commencer.
5. **Au début de chaque session** : lire `ETAT.md`, puis `CLAUDE.md`, dire en trois lignes où on en est, et reprendre à la prochaine action. **Ne re-planifie pas tout, ne relis pas tout le repo, ne refais pas d'audit.**

## 0.2 Efficacité — j'ai l'impression que tu passes des heures pour pas grand-chose

Corrige ça, c'est un critère de réussite au même titre que le reste :

- **Interdiction de refactoriser ce qui marche.** Si un fichier est moche mais fonctionne et que la tâche ne le concerne pas, on n'y touche pas.
- **Pas de nouvelle abstraction « au cas où ».** On écrit le code du besoin d'aujourd'hui.
- **Une seule nouvelle dépendance par lot**, justifiée en une ligne. Si la plateforme sait le faire, on n'installe rien.
- **Tests uniquement sur la logique de calcul** (points, scores, stats, séries). Pas de test sur du JSX qui affiche un titre.
- **Explications courtes** : cinq lignes maximum par tâche dans le chat. Le détail va dans `ETAT.md`, pas dans la conversation.
- **Le visible d'abord.** Entre une amélioration invisible et un écran que je vais voir ce soir, tu fais l'écran.
- Si tu hésites entre deux approches, prends la plus simple des deux et note le choix dans `ETAT.md`.

## 0.3 iPhone d'abord

La bande est sur iPhone. Une fonctionnalité qui marche dans Chrome sur ton ordi mais pas dans Safari sur mon téléphone **n'est pas faite**.

- Les tests Playwright tournent avec le device descriptor **iPhone sur WebKit**, pas Chromium. Une capture Chromium ne prouve rien.
- Mode standalone : `viewport-fit=cover` et `env(safe-area-inset-*)` sur la barre d'onglets, les feuilles et les boutons flottants.
- `100dvh` / `100svh`, jamais `100vh`.
- Champs de saisie à 16 px minimum, sinon Safari zoome tout seul. Gère `visualViewport` pour le clavier.
- Zones tactiles de 44 px, aucun état accessible uniquement au survol.
- `MediaRecorder` sur Safari produit du **MP4/AAC**, pas du WebM : choisis le format avec `MediaRecorder.isTypeSupported()`.
- **Les photos de l'iPhone sont en HEIC.** Il faut les convertir avant upload (voir lot B), sinon la moitié des navigateurs ne les affichent pas.
- `navigator.vibrate` n'existe pas sur iOS : repli silencieux.
- Les capteurs de mouvement exigent `DeviceOrientationEvent.requestPermission()` déclenché par un vrai tap (crucial pour le jeu « Devine qui je suis »).
- `screen.orientation.lock()` ne marche pas sur iOS : les écrans de jeu doivent être lisibles en portrait **et** en paysage.
- Utilise la **Wake Lock API** pendant les parties pour que l'écran ne s'éteigne pas.
- À la fin de chaque lot : une checklist de ce que tu as vérifié toi-même, et de ce que je dois tester à la main.

## 0.4 Ce qu'on ne touche pas

- **La direction visuelle actuelle.** L'affichage est franchement réussi, on ne le refond pas. Tout ce qui est ajouté doit se fondre dedans, pas s'y superposer.
- **Le schéma existant.** Migrations additives uniquement, versionnées dans `supabase/migrations/`, RLS explicite sur chaque nouvelle table. Jamais de `DROP` sur des données existantes.
- **Les données déjà saisies.** Un renommage de libellé ne doit rien effacer.

---

# PARTIE 1 — Les lots, dans l'ordre

Tu les fais dans cet ordre. Il va du plus visible et du moins cher au plus lourd. Après chaque lot : je teste sur mon iPhone, je donne le feu vert, on passe au suivant.

---

## LOT A — Renommages et accueil *(rapide, très visible — commence par là)*

**A1. Renommages, partout.** Dans l'interface, les stats, les exports, le seed :

| Avant | Après |
|---|---|
| calme (curseur) | **rire** |
| plante verte (déclencheur) | **Marie Jane** |
| « Ce qui a fait ta journée » | **L'anecdote** |
| étiquettes | **Lieu** |

Les données existantes sont conservées : on renomme le libellé, on ne recrée pas le champ. Le curseur « rire » garde la même échelle que « calme ».

**A2. Le fil devient la page d'accueil.** On ouvre l'app, on tombe sur le fil de la bande. La mécanique « tu ne vois les autres qu'après avoir posté » est conservée : tant que la journée n'est pas posée, le fil est flouté et une carte d'appel à l'action occupe le haut. Une fois posté, révélation animée. Un bouton flottant permanent pour ouvrir le check-in.

**A3. Profil : modifier sa photo et son nom.** Upload depuis la galerie ou l'appareil photo, recadrage carré au doigt, compression, et mise à jour immédiate partout où l'avatar apparaît. Le nom est modifiable librement (avec unicité dans la bande).

**A4. Profil : supprimer les trois compteurs** « journées d'affilée », « journées postées » et « ton record ». Ils partent complètement.

**A5. Profil : l'album personnel.** Les 10 dernières photos postées par la personne, en grille, ouvrables en plein écran. En dessous, trois ou quatre stats **discrètes** et bien choisies — pas un tableau de bord : par exemple son heure moyenne de check-in, son lieu le plus fréquent, sa proportion de journées avec vocal, son mot le plus utilisé dans les anecdotes. Petit texte, ton léger.

---

## LOT B — Photos : qualité et stockage *(le deuxième plus rentable)*

**B1. Le pipeline d'upload, à refaire proprement.**
- Conversion **HEIC → WebP** côté client (les photos d'iPhone sont en HEIC).
- Correction de l'orientation EXIF (sinon une photo sur trois arrive couchée).
- Redimensionnement à 1600 px sur le grand côté, WebP qualité 0,8 → on tombe autour de 200-350 Ko au lieu de 4 Mo.
- Génération d'une **miniature 320 px** stockée séparément : c'est elle qu'affiche le fil. Le gain de vitesse est énorme.
- Upload avec barre de progression, reprise en cas d'échec, et file d'attente hors-ligne.

**B2. La visionneuse plein écran, à la hauteur d'une vraie app photo.**
- Ouverture depuis la miniature avec transition continue (View Transitions, repli propre).
- Pincer pour zoomer, double-tap pour zoomer, déplacer l'image zoomée.
- Balayer horizontalement pour passer à la photo suivante, balayer vers le bas pour fermer avec effet élastique.
- Préchargement des photos voisines, affichage flouté progressif pendant le chargement (LQIP), jamais de carré vide.
- Indicateur de position (3/8), légende, date, lieu, auteur.
- Double-tap sur la photo = réaction, avec l'animation qui va avec.
- Boutons enregistrer dans la pellicule et partager.

**B3. Prendre une photo directement depuis l'app**, pas seulement choisir dans la galerie.

**B4. Le stockage — c'est le vrai sujet.** Supabase offre 1 Go sur le plan gratuit : avec des photos et des vidéos, ça part vite.
- Crée une **abstraction `stockage.ts`** : tout le code passe par elle, personne n'appelle Supabase Storage directement.
- Implémentation par défaut : Supabase. **Documente et prépare la bascule vers Cloudflare R2** (palier gratuit bien plus généreux, de l'ordre de 10 Go, et pas de frais de sortie), pour que le jour où on sature, ce soit une variable d'environnement à changer et pas une réécriture.
- Avec la compression du B1, une photo pèse ~300 Ko : dis-moi combien de photos ça représente et affiche-le dans l'app.
- **Écran Réglages → Stockage** : espace utilisé, par personne, par type (photos, vidéos, audio), avec une barre. Et un bouton pour libérer de la place (supprimer les doublons, les vidéos les plus lourdes).

**B5. Les vidéos courtes.** 15 secondes maximum, compressées, avec une image de couverture générée automatiquement, lecture en boucle silencieuse dans le fil et son au tap.

---

## LOT C — Les scellés

Aujourd'hui il n'y a que des mots scellés. On élargit et on soigne l'affichage.

**C1. Quatre types de scellés** : mot, photo, vidéo, audio. Même parcours de création pour les quatre.

**C2. Création depuis deux endroits** : depuis **Aujourd'hui** (un bouton discret à côté du check-in) et depuis **Souvenirs**. On choisit le type, le contenu, et la date d'ouverture (1 mois, 6 mois, 1 an, ou une date au choix).

**C3. L'indicateur discret, sans casser la mise en page.** Un petit **sablier** avec un aperçu **flouté** du contenu et le **décompte** avant ouverture. Petit, sobre, glissé dans le fil sans prendre la place des journées. Un scellé photo ou vidéo montre son aperçu flouté ; un scellé mot montre du texte brouillé ; un scellé audio montre une forme d'onde floutée.

**C4. L'empilement.** Au-delà de trois scellés en attente, on n'affiche plus une ligne par scellé : **une seule bulle empilée** avec le décompte des plus récents (par exemple les deux prochains à s'ouvrir, plus un « +5 »). Au tap, la bulle se déploie en liste complète. L'espace vertical du fil est précieux, ne le gaspille pas.

**C5. L'ouverture est un événement** : notification, animation d'ouverture qui dure assez pour qu'on ait le temps d'appeler les autres, puis le contenu rejoint automatiquement les souvenirs.

---

## LOT D — Souvenirs, stats, rétrospective

**D1. Le nouvel ordre de la page Souvenirs**, de haut en bas :
1. **Le mur de souvenirs** (la galerie) — c'est le cœur, il prend la place ;
2. **Les stats** — déplacées ici, juste après les souvenirs ;
3. **La rétrospective** — en pied de page.

**D2. La rétrospective devient un simple récap de fin de page.** Trois lignes maximum, ton léger, une bonne conclusion de page — pas un module qui prend l'écran. Cliquable pour dérouler le détail si on veut, replié par défaut.

**D3. Les stats resserrées** : on garde ce qui fait réagir (la courbe, l'effet des déclencheurs dont Marie Jane, la synchronicité de la bande, la heatmap) et on coupe le reste. Mieux vaut quatre stats qu'on regarde que douze qu'on scrolle.

---

## LOT E — Les points, et moins de badges

**E1. Un système de points unique** pour toute l'app. Barème de départ (à ajuster si tu vois mieux, mais dis-le) :

| Action | Points |
|---|---|
| Poster sa journée | 10 |
| + une anecdote écrite (20 caractères minimum) | +5 |
| + une note vocale | +8 |
| + une photo (2 maximum comptées) | +5 chacune |
| + un lieu | +2 |
| Jour de série en cours | +2 par jour, plafonné à +20 |
| Réaction donnée | +1 (10 par jour maximum) |
| Commentaire | +2 (10 par jour maximum) |
| Voter à un sondage | +2 · en créer un | +3 |
| Sceller une capsule | +5 |
| Participer à une partie de jeu | +10 |
| Podium de fin de partie | 1er +30 · 2e +15 · 3e +5 |

**E2. Anti-abus** : plafond global de 100 points par jour hors jeux ; pas de points pour un contenu supprimé dans l'heure ; pas de points pour réagir à son propre contenu.

**E3. Des niveaux**, affichés discrètement dans le profil et à côté du nom dans le fil. Trouve cinq paliers avec des noms drôles.

**E4. Réduire les badges** à huit maximum, les plus significatifs uniquement : première journée, 30 jours, 100 jours, premier 10/10, première capsule ouverte, premier podium, 1000 points, et un badge secret. Les badges supprimés ne doivent pas laisser d'écran cassé chez ceux qui les avaient.

**E5. Le classement de points**, hebdomadaire et général, dans le profil et en fin de partie. Discret, pas un tableau de bord d'entreprise.

---

## LOT F — Le lieu

**F1. Le champ « Lieu »** dans Aujourd'hui (celui qui remplace les étiquettes) : saisie libre, autocomplétion sur les lieux déjà utilisés par la bande, et un bouton **« utiliser ma position »**.

**F2. La géolocalisation** : `navigator.geolocation` sur demande explicite, puis reverse geocoding via Nominatim (OpenStreetMap, gratuit — respecte leur politique d'usage, un appel par saisie, avec cache). On stocke le libellé affichable et des coordonnées **arrondies**, pas la position exacte.

**F3. Le lieu s'attache aux photos** de la journée et s'affiche discrètement dans la visionneuse plein écran.

**F4. *(ajout de ma part)* La carte des souvenirs** : une carte (Leaflet + tuiles OpenStreetMap) avec un point par lieu et les photos associées. C'est le genre d'écran qu'on montre aux gens.

**F5. Confidentialité** : la localisation est facultative et se désactive d'un geste, elle ne sort jamais de la bande, et on peut retirer le lieu d'une journée après coup.

---

## LOT G — LES JEUX

C'est le gros morceau. Quatre sous-lots, dans cet ordre. Chacun est livrable indépendamment : mieux vaut trois jeux impeccables que dix bâclés.

### G0 — Le moteur (à faire en premier, tout le reste en dépend)

- Une nouvelle section **Jeux** dans la navigation, avec des **catégories** et des jeux dans chaque catégorie.
- Modèle commun : une partie, des joueurs, des manches, des scores. Une seule table de parties, une table de manches, un champ `type_jeu`.
- **Deux modes** : *un seul téléphone* (on se le passe) et *chacun son téléphone* (synchronisé en temps réel via Supabase Realtime). Chaque jeu déclare les modes qu'il supporte.
- **Classement discret pendant la partie** : une barre fine et permanente en haut de l'écran avec les trois avatars et leurs points, jamais envahissante.
- **Podium de fin de partie** animé, puis conversion des points de partie en points d'app (lot E).
- Wake Lock actif pendant une partie, reprise propre si l'app passe en arrière-plan, et possibilité d'abandonner une partie sans tout casser.
- Une fiche de jeu standard : nom, catégorie, nombre de joueurs, durée, règles en trois lignes, bouton « lancer ». Les règles sont lisibles **avant** de lancer, pas pendant.

### G1 — « Devine qui je suis » *(le jeu phare, soigne-le)*

Le joueur pose le téléphone sur son front, le personnage s'affiche **en très grand**, les deux autres le font deviner.

- Détection par **inclinaison** : vers le bas = trouvé, vers le haut = passer. Permission des capteurs demandée sur un vrai tap, avec repli **taper à gauche / taper à droite** si refus ou capteur indisponible.
- Compte à rebours de 60 secondes (réglable), écran vert ou rouge au feedback, bip sur les cinq dernières secondes, vibration là où elle existe.
- Récapitulatif de fin de manche : cartes trouvées, cartes passées, score, puis on passe au joueur suivant.
- Lisible en portrait **et** en paysage (iOS ne permet pas de verrouiller l'orientation), texte qui s'adapte à la longueur du nom.
- **Au moins 15 paquets de 60 cartes** : rap FR, foot, MMA et sports de combat, cinéma, séries, télé-réalité, politiques, figures historiques, mèmes internet, streamers et YouTubeurs FR, personnages de dessins animés, marques et objets du quotidien, musique internationale, « trucs qu'on trouve chez mamie », et un paquet **« Nos potes »** que la bande remplit elle-même.
- Un mode **roulette** qui pioche dans tous les paquets, et la possibilité de créer ses propres paquets.
- Ton : clivant, drôle, humour noir assumé — voir le cadre en partie 2.

### G2 — Alcool

Jeux pensés pour trois, pas des jeux à dix adaptés à l'arrache.

1. **Le Roi** — Kings Cup en version 3 joueurs, paquet virtuel, une règle par carte, règles éditables par la bande.
2. **Je n'ai jamais** — 300 affirmations minimum, trois niveaux (soft, chaud, trash), possibilité d'ajouter les siennes.
3. **Tu préfères** — dilemmes, vote simultané, les minoritaires prennent.
4. **Qui est le plus susceptible de…** — vote simultané sur un membre, révélation des trois votes en même temps.
5. **Catégories** — l'app tire un thème, chacun cite à tour de rôle, celui qui sèche prend.
6. **La chaîne** — association de mots en cinq secondes chrono.
7. **Duel de réflexe** — deux zones sur l'écran, tap au signal, tournoi à trois.
8. **La roulette** — tirage au sort d'un joueur avec animation de suspense, tirage côté serveur pour que ce soit incontestable.
9. **Le mot interdit** — l'app attribue un mot secret à chacun en début de soirée ; si tu le prononces, tu prends.
10. **Le jugement** — un joueur pose une question, les deux autres répondent, il désigne le perdant.
11. **Menteur** — deux vérités un mensonge.
12. ***(ajout de ma part)* Le quiz de la bande** — des questions générées à partir de **vos propres données** : « quelle note Momo a-t-il mise le 12 juin ? », « qui a posté le plus de vocaux ce mois-ci ? », « de quel lieu vient cette photo ? ». Aucun autre groupe au monde ne peut avoir ce jeu.
13. ***(ajout de ma part)* Blind test maison** — des extraits de vos propres notes vocales : qui parle, et de quand ça date ?

**Le cadre, à implémenter dans le moteur, pas à négocier :** l'unité est la **gorgée**, jamais le verre cul sec. Aucun jeu ne demande de boire vite ni en quantité. Un bouton « je passe » toujours disponible et sans pénalité. Un joueur peut être marqué **sobre** (il conduit) : il reçoit un gage à la place. Rappel d'eau discret toutes les 30 minutes. Un jeu qui finit à l'hôpital est un jeu raté.

### G3 — Marie Jane

Deux sous-catégories, parce que ce n'est pas le même état.

**Pendant** — peu de texte à lire, rythme lent, beaucoup de visuel :

14. **Le silence** — le premier qui parle a perdu. L'app mesure le niveau sonore du micro et annonce le perdant.
15. **L'histoire à trois** — chacun ajoute une phrase à tour de rôle. L'app enregistre le tout en audio et le range dans les souvenirs. À réécouter le lendemain.
16. **Le débat le plus con** — sujet absurde tiré au sort, deux contre un, le troisième arbitre et attribue les points.
17. **Questions de 3 h du matin** — un deck de questions existentielles et absurdes, chacun répond, vote de la meilleure réponse.
18. **Et si…** — scénarios impossibles à développer.
19. **L'écran hypnotique** — un visuel génératif en canvas qui réagit au son du micro, avec une question qui apparaît toutes les deux minutes.
20. **Devine le son** — la soundboard de la bande, extraits de vos vocaux.
21. **Le mot qui n'existe pas** — l'app donne un mot rare, chacun invente une définition, il faut retrouver la vraie.

**Après / redescente** :

22. **Le test de lucidité** — quatre mini-jeux (réflexe, mémoire, suite logique, tape la bonne couleur), un score, et **la courbe de ton score au fil de la soirée**. C'est le jeu le plus drôle à relire le lendemain.
23. **Le tournoi des munchies** — duels de bouffe en arbre à élimination, champion de la soirée.
24. **La photo la plus floue** — concours, vote, la gagnante entre au mur des souvenirs.
25. **Le récap de session** — note de la session, ce qui s'est passé, versé automatiquement dans les souvenirs.

**Le cadre** : l'app n'encourage rien et ne compte rien. Pas de compteur de consommation, pas de défi de quantité. Et tout enregistrement audio d'une session exige que **les trois aient validé**, avec un indicateur visible tant que ça tourne.

### G4 — Trio, sans rien consommer

26. **Devine qui a écrit ça** — une vieille note s'affiche sans son auteur.
27. **Le tribunal** — plainte contre un pote, preuve facultative, vote des deux autres, gage tiré au sort, casier judiciaire consultable. L'accusé peut plaider en vocal de 30 secondes.
28. **Deux vérités, un mensonge.**
29. **Dessine et fais deviner** — canvas au doigt, le téléphone tourne.
30. **Mime chrono.**
31. **Top 3** — chacun donne son top 3 sur un thème, les autres devinent l'ordre.
32. **Vrai ou faux** — culture générale absurde.
33. **Le plus rapide** — duels de réflexe, tournoi.
34. **Le pendu de la bande** — les mots sont proposés par les potes.
35. **Association d'idées chronométrée.**

---

## LOT H — Les audits *(quatre, à la fin, dans cet ordre)*

**Audit 1 — Fonctionnel.** Reprends ce `PLAN.md` point par point et rends un tableau : fait / partiel / pas fait, avec une ligne d'explication pour tout ce qui n'est pas « fait ». Teste chaque point sur iPhone, pas seulement dans le navigateur de ton ordi.

**Audit 2 — Visuel.** Capture Playwright WebKit iPhone de **chaque écran** et de **chaque état** (vide, en chargement, en erreur, avec beaucoup de données). Regarde-les vraiment. Corrige. Montre-moi les captures avant / après.

**Audit 3 — Technique.** Build sans warning, `tsc --noEmit` propre, RLS testée pour de vrai (essaie d'accéder aux données d'une autre bande et prouve que ça échoue), Lighthouse mobile, taille des bundles, requêtes N+1, comportement hors-ligne, notifications, quotas de stockage.

**Audit 4 — Parcours réel.** Trois comptes, une journée complète simulée de bout en bout, une partie de chaque catégorie de jeu, une coupure réseau au milieu d'un upload, une réinstallation de la PWA. Ce qui casse là, ce sont les vrais bugs.

---

# PARTIE 2 — Ce qui ne bouge pas

**Le cadre du trash.** Humour noir, vannes, personnages clivants : oui, c'est le but, et l'app ne s'en excuse pas. Deux limites, uniquement pour que ça reste drôle : rien qui vise un groupe pour ce qu'il est (origine, religion, orientation, handicap) — ça, ce n'est pas de l'humour noir, c'est juste nul et ça plombe une soirée ; et rien qui vise une personne réelle en dehors de la bande. À l'intérieur de ça, lâche-toi complètement.

**Le droit de retrait.** Chacun peut supprimer d'un tap une photo, une citation, un son ou un gage qui le concerne, sans se justifier et sans que ça notifie qui que ce soit. C'est exactement ce qui permet au reste d'être aussi cru.

**Bienveillance.** C'est un journal, pas un tableau de performance. Aucun classement du bonheur : les points portent sur la présence, l'attention aux autres et les jeux, jamais sur qui va le mieux. Une mauvaise journée s'affiche avec la même dignité qu'une bonne, et aucune mécanique de jeu ne peut se déclencher dessus.

**Privé.** Pas d'indexation, buckets privés, RLS stricte sur chaque table, aucune donnée qui sort de la bande.

**Code.** TypeScript strict, aucun `any`, aucun composant de 800 lignes, zéro `console.log` oublié, zéro warning au build. Interface 100 % en français.

---

# PARTIE 3 — Avant de commencer

1. Crée `CLAUDE.md` et `ETAT.md` comme décrit en 0.1.
2. Fais un audit initial court du repo (20 lignes maximum) : ce qui existe déjà parmi tout ça, pour qu'on ne refasse pas le travail.
3. Pose-moi au maximum **cinq questions**, uniquement celles dont la réponse change ton plan. Pour tout le reste, tranche et note ton choix.
4. Propose le plan détaillé du **lot A uniquement**, découpé en tâches de 40 minutes maximum, et attends mon feu vert.

Et sois franc : si une idée de ce document est mauvaise, redondante ou coûteuse pour rien, dis-le et propose mieux. Je préfère un avis tranché à une exécution docile.
