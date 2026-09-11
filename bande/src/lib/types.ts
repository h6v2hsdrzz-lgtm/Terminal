/** Les types du domaine. Une seule source pour toute l'application. */

export type Profil = {
  id: string;
  pseudo: string;
  /** 1 à 7 — index dans la palette validée, jamais un code couleur en dur. */
  teinte: number;
  initiales: string;
  /** L'adresse de sa photo, ou null : l'avatar porte alors ses initiales. */
  avatar: string | null;
};

export type Declencheur = {
  id: string;
  nom: string;
  emoji: string;
};

/**
 * De quoi traduire les identifiants d'une entrée en personnes et en
 * déclencheurs. Les entrées ne portent que des identifiants : dupliquer le
 * pseudo dans chaque ligne, ce serait le voir changer partout sauf dans le
 * passé le jour où quelqu'un le modifie.
 */
export type Annuaire = {
  profils: Profil[];
  declencheurs: Declencheur[];
};

export type Reaction = {
  emoji: string;
  parQui: string[];
};

export type Commentaire = {
  id: string;
  auteurId: string;
  auteur: string;
  texte: string;
  quand: string;
};

/**
 * Une photo ou une vidéo de journée, telle que l'écran la reçoit.
 *
 * Jamais les octets : ils passent par des routes dédiées, et un fil de douze
 * journées en ferait transiter des dizaines de méga-octets dans le HTML.
 */
export type Media = {
  id: string;
  genre: "photo" | "video";
  /** L'original — pour le plein écran, et pour lire une vidéo. */
  url: string;
  /** La version réduite — pour le fil et la galerie. */
  vignette: string;
  largeur: number;
  hauteur: number;
  /** En millisecondes, pour une vidéo. */
  duree: number | null;
  legende: string | null;
};

/** La note vocale, sans ses octets : ils passent par une route dédiée. */
export type Audio = {
  url: string;
  /** En millisecondes. */
  duree: number;
  /** L'enveloppe sonore mesurée à l'enregistrement, pour la forme d'onde. */
  niveaux: number[];
};

export type Etiquette = {
  id: string;
  nom: string;
};

export type Entree = {
  id: string;
  /** Jour de la mesure, ISO `AAAA-MM-JJ`. */
  jour: string;
  profil: string;
  joie: number;
  /** Trois mots maximum, ou rien. */
  titre: string | null;
  note: string | null;
  /** Facultatifs, et hors de tout classement. */
  energie: number | null;
  calme: number | null;
  declencheurs: string[];
  etiquettes: Etiquette[];
  photos: Media[];
  audio: Audio | null;
  reactions: Reaction[];
  commentaires: Commentaire[];
  posteA: string;
  /** L'instant exact de la publication, en ISO. Sert au repère « nouveau ». */
  creeA: string;
  /** Remontée en haut du fil, pour toute la bande. */
  epingle: boolean;
};

/**
 * Ce que la recherche rend : une trouvaille par endroit où les mots sont, et
 * pas une par journée. Un mot dans un commentaire et un mot dans la note de la
 * même journée sont deux raisons différentes de s'y rendre.
 */
export type Trouvaille = {
  /** L'identifiant de l'entrée, pour l'ancre dans la journée. */
  entreeId: string;
  jour: string;
  /** Qui a écrit la journée — pas forcément qui a écrit le morceau trouvé. */
  profil: string;
  ou: "journee" | "commentaire" | "legende" | "etiquette";
  /** Qui a écrit le morceau trouvé, quand ce n'est pas l'auteur de la journée. */
  parQui: string | null;
  titre: string | null;
  /** Le morceau où les mots ont été trouvés, déjà recadré. */
  extrait: string;
};

/** Les filtres rapides du fil. Un seul actif à la fois. */
export type FiltreFil =
  | { genre: "tout" }
  | { genre: "photo" }
  | { genre: "vocal" }
  | { genre: "personne"; profil: string };

/** Une page du fil : des journées, et de quoi demander la suivante. */
export type PageFil = {
  /** Groupées par jour, du plus récent au plus ancien. */
  journees: { jour: string; entrees: Entree[] }[];
  /** Le jour à passer en curseur pour la page suivante, ou `null` à la fin. */
  curseur: string | null;
};

export type Badge = {
  cle: string;
  nom: string;
  description: string;
  emoji: string;
  obtenuLe: string | null;
};
