/** Les types du domaine. Une seule source pour toute l'application. */

export type Profil = {
  id: string;
  pseudo: string;
  /** 1 à 5 — index dans la palette validée, jamais un code couleur en dur. */
  teinte: 1 | 2 | 3 | 4 | 5;
  initiales: string;
};

export type Declencheur = {
  id: string;
  nom: string;
  emoji: string;
};

export type Reaction = {
  emoji: string;
  parQui: string[];
};

export type Commentaire = {
  id: string;
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
