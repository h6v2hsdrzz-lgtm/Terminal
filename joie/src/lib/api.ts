/**
 * Appels réseau côté navigateur. Les erreurs de validation renvoyées par
 * l'API remontent telles quelles jusqu'au formulaire, qui les affiche champ
 * par champ.
 */
import type { Entree, SaisieEntree } from "./types";
import type { Champ } from "./validation";

export class ErreurApi extends Error {
  erreurs: Partial<Record<Champ, string>>;

  constructor(message: string, erreurs: Partial<Record<Champ, string>> = {}) {
    super(message);
    this.name = "ErreurApi";
    this.erreurs = erreurs;
  }
}

async function lireErreur(reponse: Response): Promise<never> {
  let message = `Erreur ${reponse.status}`;
  let erreurs: Partial<Record<Champ, string>> = {};
  try {
    const corps = await reponse.json();
    if (typeof corps?.message === "string") message = corps.message;
    if (corps?.erreurs && typeof corps.erreurs === "object") erreurs = corps.erreurs;
  } catch {
    // Réponse sans JSON : le message par défaut fera l'affaire.
  }
  throw new ErreurApi(message, erreurs);
}

export async function chargerEntrees(): Promise<Entree[]> {
  const reponse = await fetch("/api/entrees", { cache: "no-store" });
  if (!reponse.ok) await lireErreur(reponse);
  const { entrees } = await reponse.json();
  return entrees as Entree[];
}

export async function creerEntree(saisie: SaisieEntree): Promise<Entree> {
  const reponse = await fetch("/api/entrees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saisie),
  });
  if (!reponse.ok) await lireErreur(reponse);
  const { entree } = await reponse.json();
  return entree as Entree;
}

export async function majEntree(id: string, saisie: SaisieEntree): Promise<Entree> {
  const reponse = await fetch(`/api/entrees/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saisie),
  });
  if (!reponse.ok) await lireErreur(reponse);
  const { entree } = await reponse.json();
  return entree as Entree;
}

export async function effacerEntree(id: string): Promise<void> {
  const reponse = await fetch(`/api/entrees/${id}`, { method: "DELETE" });
  if (!reponse.ok && reponse.status !== 204) await lireErreur(reponse);
}
