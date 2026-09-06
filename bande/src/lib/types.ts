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
};

export type Badge = {
  cle: string;
  nom: string;
  description: string;
  emoji: string;
  obtenuLe: string | null;
};
