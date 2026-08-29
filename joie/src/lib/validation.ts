/**
 * Validation de la charge utile d'une entrée. Partagée entre le formulaire
 * et les routes d'API : le navigateur signale les erreurs tout de suite, le
 * serveur ne fait jamais confiance à ce qu'il reçoit.
 */
import { JOIE_MAX, JOIE_MIN, estPersonne } from "./constantes";
import { estDateIso } from "./date";
import type { SaisieEntree } from "./types";

export const NOTES_MAX = 500;

export type Champ = keyof SaisieEntree;

export type Resultat =
  | { ok: true; valeur: SaisieEntree }
  | { ok: false; erreurs: Partial<Record<Champ, string>> };

export function validerSaisie(brut: unknown): Resultat {
  const erreurs: Partial<Record<Champ, string>> = {};
  const source = (typeof brut === "object" && brut !== null ? brut : {}) as Record<string, unknown>;

  const date = typeof source.date === "string" ? source.date.trim() : "";
  if (!estDateIso(date)) erreurs.date = "Date attendue au format AAAA-MM-JJ.";

  const personne = source.personne;
  if (!estPersonne(personne)) erreurs.personne = "Personne inconnue.";

  const joie = typeof source.joie === "number" ? source.joie : Number(source.joie);
  if (!Number.isInteger(joie) || joie < JOIE_MIN || joie > JOIE_MAX) {
    erreurs.joie = `La joie est un entier entre ${JOIE_MIN} et ${JOIE_MAX}.`;
  }

  const notesBrutes = source.notes;
  let notes: string | null = null;
  if (typeof notesBrutes === "string") {
    const taille = notesBrutes.trim();
    if (taille.length > NOTES_MAX) erreurs.notes = `${NOTES_MAX} caractères maximum.`;
    notes = taille.length > 0 ? taille : null;
  } else if (notesBrutes != null) {
    erreurs.notes = "Notes invalides.";
  }

  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };

  return {
    ok: true,
    valeur: {
      date,
      personne: personne as SaisieEntree["personne"],
      joie,
      biberon: Boolean(source.biberon),
      planteVerte: Boolean(source.planteVerte),
      notes,
    },
  };
}
