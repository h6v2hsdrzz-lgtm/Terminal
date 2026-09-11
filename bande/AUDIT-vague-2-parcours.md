# Audit de la vague 2 — le parcours réel, à trois téléphones

> Lot R, audit n° 3. Trois contextes de navigateur, c'est-à-dire trois
> téléphones, et on joue pour de vrai. `e2e/audit3.spec.ts`.

Les lots N et O éprouvent le moteur à **deux** téléphones. Deux suffisent pour
montrer qu'un écran dépend du rôle ; ils ne montrent pas qu'une partie à trois se
déroule, ni qu'un troisième écran retrouve la bonne manche, ni — on l'a appris —
que les boutons sont au bon endroit.

## Ce qui a été joué

| Parcours | Ce qu'il prouve |
| --- | --- |
| « Je n'ai jamais » jusqu'au podium | même carte sur les **trois** écrans, chacun répond chez lui, l'hôte enchaîne, le podium arrive partout |
| « Devine qui je suis » | un devine sans voir le mot, **les deux autres** le voient, et n'importe lequel des trois termine la manche |
| « Le plus rapide » | le signal part au même instant pour les trois, personne ne brûle le départ, chacun voit son temps |
| Un téléphone qui se recharge | il retrouve la **même** manche et peut encore répondre : l'état venait du serveur |
| Une journée posée | elle arrive sur les deux autres téléphones **toute seule** |
| Une journée coupée en plein réseau | elle est gardée, l'écran le dit, et elle part seule au retour du réseau |
| Le lien profond | `/jour/<date>` ouvre bien la journée qu'une notification désigne |

## Les deux défauts trouvés — et aucun n'était visible à deux téléphones

### 1. Corriger sa journée ne changeait rien chez les autres

Le fil garde deux empreintes de ce que le serveur vient de rendre : la
**structure** (quelles journées, quelles entrées) et le **détail** (épingles,
réactions, commentaires). Une correction — un titre, une note, une photo
ajoutée — ne touchait **ni l'une ni l'autre**.

Conséquence : la version de la bande changeait bien, le serveur refaisait son
rendu, et le fil décidait qu'il n'y avait rien de neuf. Les deux autres
téléphones gardaient l'ancienne version **jusqu'au prochain rechargement**.

Le contenu fait maintenant partie de l'empreinte de détail. Vérifié dans les
deux sens : le test échoue quand on retire le correctif.

### 2. Les souffleurs n'avaient pas de boutons

Le plan est explicite : « le porteur voit la carte, **les deux autres voient un
écran “fais deviner” avec les boutons Trouvé et Passer** ». Ils n'étaient que
chez celui qui devine.

À deux téléphones, ça ne se remarque pas : il y a un acteur et un souffleur, le
jeu avance. À trois, on voit que les deux personnes qui **savent** si la réponse
est juste sont les seules à ne pas pouvoir le dire.

Les trois les ont maintenant, et les deux endroits se valent pour une bonne
raison : celui qui devine est le seul à pouvoir abandonner, les souffleurs sont
les seuls à savoir s'il a trouvé. Le premier qui appuie termine la manche. Il a
fallu aussi changer le serveur de la manche : seul le geste de l'acteur était
écouté, donc les nouveaux boutons n'auraient rien fait.

## Ce qui ne peut pas être joué ici

Le WebKit de Playwright n'est pas Safari iOS. Il n'a **ni `MediaRecorder`, ni
`PushManager`, ni `Notification`**, et le sélecteur de fichiers d'iOS ne s'y
ouvre pas. Donc :

- **« La théorie du complot » et « Le tribunal des idées »** ne se jouent pas :
  ils sont faits d'un enregistrement audio. Leur moteur est couvert (archétype
  « parole »), leur micro ne l'est pas ;
- **la notification qui arrive** ne se teste pas. Ce qui est testé, c'est
  l'écran qu'elle ouvre — et le chiffrement, lui, est vérifié en Vitest contre
  les intermédiaires publiés du RFC 8291 ;
- **la photo prise à la caméra** ne se teste pas. L'envoi, le transcodage et la
  reprise après coupure, si.

Ces trois-là sont la raison d'être de l'essai à la main sur un vrai iPhone, et
ils sont écrits comme tels dans `ETAT.md`.

## Ce qui reste à faire avec trois vrais téléphones

1. Une notification reçue, touchée, et l'écran qu'elle ouvre.
2. Une photo prise à la caméra, et une choisie dans la pellicule (HEIC).
3. Une partie de « La théorie du complot » et une du « Tribunal des idées »,
   avec le micro — puis le renvoi du lendemain matin.
4. Le Wake Lock : l'écran ne doit pas s'éteindre pendant une partie.
5. Le retour haptique, qui n'existe que sur l'appareil.
