import type { Personne } from "./constantes";

/** Une entrée telle qu'elle circule entre l'API et l'interface. */
export type Entree = {
  id: string;
  /** Date ISO `AAAA-MM-JJ` — affichée en JJ/MM/AAAA. */
  date: string;
  personne: Personne;
  joie: number;
  biberon: boolean;
  planteVerte: boolean;
  notes: string | null;
  creeLe: string;
  modifieLe: string;
};

/** Charge utile acceptée par POST /api/entrees et PATCH /api/entrees/:id. */
export type SaisieEntree = {
  date: string;
  personne: Personne;
  joie: number;
  biberon: boolean;
  planteVerte: boolean;
  notes: string | null;
};
