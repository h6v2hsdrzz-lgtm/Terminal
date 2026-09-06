/**
 * Les dix jeux, et ce qu'on en dit avant de lancer.
 *
 * Le plan en listait trente-cinq et prévenait lui-même : « mieux vaut trois
 * jeux impeccables que dix bâclés ». La bande en a demandé **au moins dix**.
 * Ce sont donc dix, choisis pour tenir à TROIS — pas des jeux à dix adaptés à
 * l'arrache — et dont deux n'existent que chez eux, parce qu'ils se nourrissent
 * du journal.
 *
 * Ce qui est écrit ici est lu AVANT de lancer, jamais pendant. Personne ne lit
 * une règle en cours de partie.
 */

/** Les catégories, dans l'ordre où elles s'affichent. */
export const CATEGORIES = [
  { cle: "classique", nom: "Le classique", sous: "Celui qu'on relance toujours" },
  { cle: "verre", nom: "Avec un verre", sous: "À la gorgée, jamais cul sec" },
  { cle: "froid", nom: "À froid", sous: "Sans rien consommer" },
  { cle: "vous", nom: "Rien qu'à vous", sous: "Tirés de votre propre journal" },
] as const;

export type CleCategorie = (typeof CATEGORIES)[number]["cle"];

export type Jeu = {
  cle: string;
  nom: string;
  categorie: CleCategorie;
  emoji: string;
  /** Trois lignes, pas quatre. Une règle qu'on doit dérouler n'est pas lue. */
  regles: [string, string, string];
  /** En minutes, pour situer : « on a vingt minutes » est une vraie question. */
  duree: number;
  /** Vrai si le jeu fait boire — il passe alors par le cadre (voir cadre.ts). */
  boit: boolean;
};

export const JEUX: Jeu[] = [
  {
    cle: "devine-qui",
    nom: "Devine qui je suis",
    categorie: "classique",
    emoji: "🙈",
    regles: [
      "Tu poses le téléphone sur ton front sans regarder l'écran.",
      "Les deux autres te font deviner le nom qui s'affiche.",
      "Penche vers le bas quand c'est trouvé, vers le haut pour passer.",
    ],
    duree: 15,
    boit: false,
  },
  {
    cle: "jamais",
    nom: "Je n'ai jamais",
    categorie: "verre",
    emoji: "🫣",
    regles: [
      "Une affirmation s'affiche : « je n'ai jamais… ».",
      "Ceux qui l'ont déjà fait prennent une gorgée.",
      "Trois niveaux, du plus soft au plus sale. Tu passes quand tu veux.",
    ],
    duree: 20,
    boit: true,
  },
  {
    cle: "prefere",
    nom: "Tu préfères",
    categorie: "verre",
    emoji: "⚖️",
    regles: [
      "Deux options, aucune n'est bonne. Chacun vote en cachant l'écran.",
      "On révèle les trois votes en même temps.",
      "Ceux qui sont en minorité prennent une gorgée.",
    ],
    duree: 15,
    boit: true,
  },
  {
    cle: "susceptible",
    nom: "Qui est le plus susceptible de",
    categorie: "verre",
    emoji: "👉",
    regles: [
      "Une situation s'affiche, chacun désigne quelqu'un — soi compris.",
      "Révélation simultanée des trois votes.",
      "Le plus désigné prend une gorgée par voix reçue.",
    ],
    duree: 15,
    boit: true,
  },
  {
    cle: "jugement",
    nom: "Le jugement",
    categorie: "verre",
    emoji: "⚡",
    regles: [
      "Un juge est tiré au sort et pose la question de son choix.",
      "Les deux autres répondent à voix haute, comme ils veulent.",
      "Le juge désigne la pire réponse : elle prend une gorgée.",
    ],
    duree: 15,
    boit: true,
  },
  {
    cle: "menteur",
    nom: "Menteur",
    categorie: "froid",
    emoji: "🎭",
    regles: [
      "Tu annonces trois choses sur toi : deux vraies, une fausse.",
      "Les deux autres votent en secret pour le mensonge.",
      "Un point par personne trompée, un point à chaque bonne réponse.",
    ],
    duree: 20,
    boit: false,
  },
  {
    cle: "top3",
    nom: "Top 3",
    categorie: "froid",
    emoji: "🥇",
    regles: [
      "Un thème est tiré ; tu écris ton top 3 sans le montrer.",
      "Les deux autres essaient de remettre tes trois réponses dans l'ordre.",
      "Deux points par place exacte, un point si la réponse y est mais ailleurs.",
    ],
    duree: 20,
    boit: false,
  },
  {
    cle: "plus-rapide",
    nom: "Le plus rapide",
    categorie: "froid",
    emoji: "⚡️",
    regles: [
      "L'écran devient vert après un délai que personne ne connaît.",
      "Le premier à toucher sa moitié d'écran gagne la manche.",
      "Toucher avant le vert, c'est perdu. Tournoi en cinq manches.",
    ],
    duree: 10,
    boit: false,
  },
  {
    cle: "quiz-bande",
    nom: "Le quiz de la bande",
    categorie: "vous",
    emoji: "🔎",
    regles: [
      "Les questions sortent de votre propre journal, pas d'une base à nous.",
      "Qui a posté le plus de vocaux ? Quelle note ce jour-là ? Quel lieu ?",
      "Un point par bonne réponse. Aucun autre groupe ne peut avoir ce jeu.",
    ],
    duree: 15,
    boit: false,
  },
  {
    cle: "qui-a-ecrit",
    nom: "Devine qui a écrit ça",
    categorie: "vous",
    emoji: "✍️",
    regles: [
      "Une vieille anecdote du journal s'affiche, sans son auteur.",
      "Chacun devine qui l'a écrite — sauf l'auteur, qui ne joue pas ce tour.",
      "Un point par bonne réponse. Les plus vieilles sont les plus dures.",
    ],
    duree: 15,
    boit: false,
  },
];

export function jeuParCle(cle: string): Jeu | undefined {
  return JEUX.find((j) => j.cle === cle);
}

export function jeuxDeCategorie(categorie: CleCategorie): Jeu[] {
  return JEUX.filter((j) => j.categorie === categorie);
}
