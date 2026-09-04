/** Les types du domaine. Une seule source pour toute l'application. */

export type Profil = {
  id: string;
  pseudo: string;
  /** 1 à 7 — index dans la palette validée, jamais un code couleur en dur. */
  teinte: number;
  initiales: string;
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

export type Entree = {
  id: string;
  /** Jour de la mesure, ISO `AAAA-MM-JJ`. */
  jour: string;
  profil: string;
  joie: number;
  note: string | null;
  declencheurs: string[];
  photo: string | null;
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
