import "server-only";

import type { Personne } from "./constantes";
import { prisma } from "./db";
import type { Entree, SaisieEntree } from "./types";

/**
 * Accès aux données. Les routes d'API et les composants serveur passent par
 * ici : c'est le seul endroit qui connaît Prisma, et le seul qui traduit une
 * ligne de base en objet d'interface.
 */

type LigneEntree = {
  id: string;
  date: string;
  personne: string;
  joie: number;
  biberon: boolean;
  planteVerte: boolean;
  notes: string | null;
  creeLe: Date;
  modifieLe: Date;
};

function versEntree(ligne: LigneEntree): Entree {
  return {
    id: ligne.id,
    date: ligne.date,
    personne: ligne.personne as Personne,
    joie: ligne.joie,
    biberon: ligne.biberon,
    planteVerte: ligne.planteVerte,
    notes: ligne.notes,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

/** Journal complet, du plus récent au plus ancien. */
export async function listerEntrees(): Promise<Entree[]> {
  const lignes = await prisma.entree.findMany({
    orderBy: [{ date: "desc" }, { personne: "asc" }],
  });
  return lignes.map(versEntree);
}

export async function trouverEntree(id: string): Promise<Entree | null> {
  const ligne = await prisma.entree.findUnique({ where: { id } });
  return ligne ? versEntree(ligne) : null;
}

/**
 * Enregistre une mesure. Une seule entrée par personne et par jour : si elle
 * existe déjà, elle est remplacée plutôt que dupliquée (le formulaire prévient
 * l'utilisateur avant, en pré-remplissant les champs existants).
 */
export async function enregistrerEntree(saisie: SaisieEntree): Promise<Entree> {
  const ligne = await prisma.entree.upsert({
    where: { date_personne: { date: saisie.date, personne: saisie.personne } },
    create: saisie,
    update: saisie,
  });
  return versEntree(ligne);
}

export async function modifierEntree(id: string, saisie: SaisieEntree): Promise<Entree> {
  const ligne = await prisma.entree.update({ where: { id }, data: saisie });
  return versEntree(ligne);
}

export async function supprimerEntree(id: string): Promise<void> {
  await prisma.entree.delete({ where: { id } });
}
