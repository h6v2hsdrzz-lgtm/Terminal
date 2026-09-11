/**
 * Le contenu des trois jeux du lot O.
 *
 * Ils ont un point commun : **on parle**. Pas de boutons à enchaîner, pas de
 * score à surveiller — du temps mort qu'on remplit soi-même. C'est ce que la
 * bande a demandé sous le nom de « Marie Janne » : peu de texte à lire, rythme
 * lent, et de quoi rigoler le lendemain en réécoutant.
 *
 * Les limites du cadre valent ici comme ailleurs : rien qui vise un groupe pour
 * ce qu'il est, rien de sexuel impliquant des mineurs, rien qui vise quelqu'un
 * d'extérieur à la bande. Un mot de passe doit être PLAÇABLE — « nonobstant »
 * se case dans une phrase, « chrysanthème » aussi ; un mot que personne ne peut
 * dire sans avoir l'air de réciter ne fait pas un jeu.
 */

/**
 * Les mots à placer.
 *
 * Le bon mot est celui qu'on peut glisser sans que ça s'entende, mais qu'on
 * remarque si on écoute. Trop banal (« chaise »), il passe inaperçu et personne
 * ne grille personne ; trop rare (« anacoluthe »), il est impossible à placer et
 * le joueur abandonne au bout de dix minutes. Ceux-là sont au milieu.
 */
export const MOTS_DE_PASSE: string[] = [
  "nonobstant", "chrysanthème", "moutarde", "tergiverser", "aquarium",
  "protocole", "vélodrome", "saumure", "pneumatique", "gargouille",
  "kiosque", "ravioli", "détartrant", "syndicat", "tortue",
  "cardinal", "polystyrène", "wagon", "brocante", "cachalot",
  "escalope", "girouette", "hameçon", "javelot", "laborantin",
  "mezzanine", "nougat", "ossature", "pilotis", "quincaillerie",
  "réverbère", "sandale", "tapioca", "urticaire", "vestiaire",
  "xylophone", "yaourt", "zeppelin", "accordéon", "bouturage",
  "cageot", "dromadaire", "épluchure", "fanfare", "goudron",
  "houppette", "igloo", "jonquille", "képi", "linoléum",
  "macramé", "nénuphar", "orthodontie", "paillasson", "quenelle",
  "rutabaga", "sciure", "trombone", "ustensile", "varicelle",
  "wapiti", "zigzag", "ampoule", "bidon", "cadenas",
  "dentelle", "étrier", "fourmilière", "grelot", "harpon",
  "isoloir", "jardinerie", "klaxon", "loutre", "mandarine",
  "notaire", "obélisque", "pastèque", "quartier", "radiateur",
  "serpillière", "tuyauterie", "uniforme", "vermicelle", "wagonnet",
];

/**
 * Les deux moitiés d'une théorie du complot.
 *
 * On tire une chose dans chaque liste, et c'est tout : le jeu est de les relier.
 * Les deux listes sont séparées exprès — un tirage dans une seule liste
 * donnerait des paires du même monde (« les pigeons » et « les corbeaux »), et
 * c'est précisément l'absence de rapport qui fait le jeu.
 */
export const COMPLOTS_A: string[] = [
  "les pigeons", "les ronds-points", "les codes-barres", "la météo",
  "les chats", "les escalators", "le pain de mie", "les nuages",
  "les chariots de supermarché", "les paillassons", "les néons",
  "les distributeurs de billets", "les cônes de chantier", "les mouettes",
  "les ascenseurs", "les cartes de fidélité", "les bouches d'égout",
  "les abribus", "les poteaux téléphoniques", "les rideaux d'hôtel",
  "les tapis roulants", "les hamsters", "les panneaux « sortie »",
  "les cabines d'essayage", "les tickets de caisse", "les pigeons voyageurs",
  "les horloges de gare", "les pigeonniers", "les distributeurs de café",
  "les bancs publics",
];

export const COMPLOTS_B: string[] = [
  "les bornes de recharge", "le prix du beurre", "les couchers de soleil",
  "la disparition des chaussettes", "le trafic du périphérique",
  "les files d'attente", "le goût des tomates", "les pannes d'Internet",
  "les prénoms à la mode", "les embouteillages du dimanche",
  "la longueur des reçus", "les pubs qu'on voit trois fois",
  "les gens qui marchent lentement", "le retard des trains",
  "le bruit des voisins du dessus", "la température des bureaux",
  "les mots de passe oubliés", "la batterie des téléphones",
  "les chaussures qui grincent", "le sens des portes",
  "les sonneries par défaut", "la disposition des supermarchés",
  "les tickets de parking", "les serrures qui coincent",
  "la buée sur les miroirs", "les câbles emmêlés",
  "la hauteur des plafonds", "les pièces de un centime",
  "le silence dans les ascenseurs", "les jours fériés qui tombent un samedi",
];

/**
 * Les amorces du tribunal des idées.
 *
 * Une amorce, pas un sujet : on défend SON idée, l'amorce ne fait que donner le
 * terrain. Sans elle, les trois premiers tours partent tous sur « une
 * application pour… » et le jeu s'éteint.
 */
export const TRIBUNAL: string[] = [
  "Une invention pour les gens pressés.",
  "Un commerce qui n'existe pas encore dans ta rue.",
  "Un service qui rendrait le lundi supportable.",
  "Un objet du quotidien, mais en mieux.",
  "Une entreprise qui ne peut fonctionner qu'en France.",
  "Un abonnement dont personne n'a besoin, et que tout le monde prendrait.",
  "Une invention qui résout un problème que tu es seul à avoir.",
  "Un métier qui n'existera que dans dix ans.",
  "Une application dont ta grand-mère serait la première cliente.",
  "Un restaurant avec une seule règle absurde.",
  "Un moyen de transport pour trois kilomètres.",
  "Un produit vendu uniquement la nuit.",
  "Une chaîne de magasins dans les gares.",
  "Un service qu'on offrirait à quelqu'un qu'on n'aime pas trop.",
  "Une invention pour ne plus jamais faire la queue.",
  "Un objet qu'on garderait toute sa vie.",
  "Une idée qui te rendrait riche en six mois.",
  "Un truc à installer dans tous les ascenseurs.",
  "Une réforme du dimanche soir.",
  "Un business qui marche seulement en hiver.",
];
