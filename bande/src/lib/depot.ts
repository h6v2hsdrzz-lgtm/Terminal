import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { TAILLE_MAX_BANDE, TEINTES } from "./couleurs";
import { codeInvitation, creerCodeReprise, decouperCodeReprise, normaliserCode, verifierCodeReprise } from "./codes";
import { initialesDeLaBande } from "./initiales";
import type { Declencheur, Entree, Profil } from "./types";

/**
 * Tout ce qui touche la base passe par ici.
 *
 * Les fonctions rendent les types du domaine (`src/lib/types.ts`), jamais les
 * lignes Prisma : les écrans n'ont pas à savoir comment c'est rangé, et le jour
 * où le stockage change, il n'y a que ce fichier à rouvrir.
 */

export const DECLENCHEURS_PAR_DEFAUT = [
  { nom: "Biberon", emoji: "🍼" },
  { nom: "Plante verte", emoji: "🌿" },
  { nom: "Sport", emoji: "🏃" },
];

export class ErreurMetier extends Error {}

// ── Entrer dans une bande ────────────────────────────────────────────────────

export async function creerBande(nomBande: string, pseudo: string) {
  const code = await codeLibre();
  const reprise = creerCodeReprise();

  const groupe = await prisma.groupe.create({
    data: {
      nom: nomBande.trim(),
      codeInvitation: code,
      declencheurs: {
        create: DECLENCHEURS_PAR_DEFAUT.map((d, ordre) => ({ ...d, ordre })),
      },
      membres: {
        create: {
          pseudo: pseudo.trim(),
          teinte: TEINTES[0],
          poigneeReprise: reprise.poignee,
          codeReprise: reprise.empreinte,
        },
      },
    },
    include: { membres: true },
  });

  return { groupe, membre: groupe.membres[0], codeReprise: reprise.enClair };
}

export async function rejoindreBande(codeSaisi: string, pseudo: string) {
  const code = normaliserCode(codeSaisi);
  const groupe = await prisma.groupe.findUnique({
    where: { codeInvitation: code },
    include: { membres: { select: { pseudo: true, teinte: true } } },
  });
  if (!groupe) throw new ErreurMetier("Aucune bande ne porte ce code.");

  const nom = pseudo.trim();
  // Le message ne reprend ni la casse saisie ni un article genré : « il y a
  // déjà un bob » se trompe deux fois en cinq mots.
  const pris = groupe.membres.find((m) => m.pseudo.toLowerCase() === nom.toLowerCase());
  if (pris) {
    throw new ErreurMetier(`« ${pris.pseudo} » est déjà pris dans cette bande. Prends une variante.`);
  }
  if (groupe.membres.length >= TAILLE_MAX_BANDE) {
    throw new ErreurMetier(
      `Cette bande est au complet : ${TAILLE_MAX_BANDE} personnes, ${TAILLE_MAX_BANDE} couleurs qui se distinguent vraiment.`,
    );
  }

  // La première teinte libre : les couleurs restent stables même si quelqu'un
  // s'en va, et deux membres n'en partagent jamais une.
  const prises = new Set(groupe.membres.map((m) => m.teinte));
  const teinte = TEINTES.find((t) => !prises.has(t))!;

  const reprise = creerCodeReprise();
  const membre = await prisma.membre.create({
    data: {
      groupeId: groupe.id,
      pseudo: nom,
      teinte,
      poigneeReprise: reprise.poignee,
      codeReprise: reprise.empreinte,
    },
  });

  return { groupe, membre, codeReprise: reprise.enClair };
}

/** Retrouver son compte depuis un autre appareil. */
export async function reprendreCompte(codeSaisi: string) {
  const decoupe = decouperCodeReprise(codeSaisi);
  if (!decoupe) throw new ErreurMetier("Ce code n'a pas la bonne forme.");

  const membre = await prisma.membre.findUnique({ where: { poigneeReprise: decoupe.poignee } });
  // Un seul message pour « poignée inconnue » et « secret faux » : distinguer
  // les deux dirait à un curieux quelles poignées existent.
  const messageUnique = "Ce code de reprise ne correspond à rien.";
  if (!membre) throw new ErreurMetier(messageUnique);
  if (!verifierCodeReprise(decoupe.secret, decoupe.poignee, membre.codeReprise)) {
    throw new ErreurMetier(messageUnique);
  }
  return membre;
}

async function codeLibre(): Promise<string> {
  // 29 caractères sur 6 positions : la collision est improbable, mais elle
  // ferait échouer la création avec une erreur d'unicité incompréhensible.
  for (let essai = 0; essai < 12; essai += 1) {
    const code = codeInvitation();
    if (!(await prisma.groupe.findUnique({ where: { codeInvitation: code }, select: { id: true } }))) {
      return code;
    }
  }
  throw new ErreurMetier("Impossible de tirer un code d'invitation libre.");
}

// ── Lire ─────────────────────────────────────────────────────────────────────

const AVEC_TOUT = {
  membre: { select: { id: true } },
  declencheurs: { select: { declencheurId: true } },
  reactions: { select: { emoji: true, membreId: true } },
  commentaires: {
    orderBy: { creeLe: "asc" },
    select: { id: true, texte: true, creeLe: true, membre: { select: { pseudo: true } } },
  },
} satisfies Prisma.EntreeInclude;

type LigneEntree = Prisma.EntreeGetPayload<{ include: typeof AVEC_TOUT }>;

const HEURE = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function versEntree(ligne: LigneEntree): Entree {
  // Les réactions arrivent à plat ; l'écran les veut groupées par emoji.
  const parEmoji = new Map<string, string[]>();
  for (const r of ligne.reactions) {
    if (!parEmoji.has(r.emoji)) parEmoji.set(r.emoji, []);
    parEmoji.get(r.emoji)!.push(r.membreId);
  }

  return {
    id: ligne.id,
    jour: ligne.jour,
    profil: ligne.membreId,
    joie: ligne.joie,
    note: ligne.note,
    declencheurs: ligne.declencheurs.map((d) => d.declencheurId),
    photo: ligne.photo,
    reactions: [...parEmoji].map(([emoji, parQui]) => ({ emoji, parQui })),
    commentaires: ligne.commentaires.map((c) => ({
      id: c.id,
      auteur: c.membre.pseudo,
      texte: c.texte,
      quand: HEURE.format(c.creeLe),
    })),
    posteA: HEURE.format(ligne.creeLe),
  };
}

export type Contexte = {
  groupe: { id: string; nom: string; codeInvitation: string; revelerApresPost: boolean };
  profils: Profil[];
  declencheurs: Declencheur[];
  moi: Profil;
};

/** Tout ce dont un écran a besoin avant même de parler d'entrées. */
export async function chargerContexte(membreId: string): Promise<Contexte | null> {
  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    include: {
      groupe: {
        include: {
          membres: { orderBy: { creeLe: "asc" } },
          declencheurs: { where: { actif: true }, orderBy: { ordre: "asc" } },
        },
      },
    },
  });
  if (!membre) return null;

  const marques = initialesDeLaBande(membre.groupe.membres.map((m) => m.pseudo));
  const profils = membre.groupe.membres.map((m, index) => ({
    id: m.id,
    pseudo: m.pseudo,
    teinte: m.teinte,
    initiales: marques[index],
  }));

  return {
    groupe: {
      id: membre.groupe.id,
      nom: membre.groupe.nom,
      codeInvitation: membre.groupe.codeInvitation,
      revelerApresPost: membre.groupe.revelerApresPost,
    },
    profils,
    declencheurs: membre.groupe.declencheurs.map((d) => ({ id: d.id, nom: d.nom, emoji: d.emoji })),
    moi: profils.find((p) => p.id === membreId)!,
  };
}

export async function listerEntrees(groupeId: string, depuis?: string): Promise<Entree[]> {
  const lignes = await prisma.entree.findMany({
    where: { groupeId, ...(depuis ? { jour: { gte: depuis } } : {}) },
    orderBy: [{ jour: "desc" }, { creeLe: "asc" }],
    include: AVEC_TOUT,
  });
  return lignes.map(versEntree);
}

// ── Écrire ───────────────────────────────────────────────────────────────────

export async function poserJournee(
  membreId: string,
  groupeId: string,
  jour: string,
  saisie: { joie: number; note: string | null; declencheurs: string[] },
): Promise<Entree> {
  const joie = Math.round(saisie.joie);
  if (!Number.isFinite(joie) || joie < 1 || joie > 10) {
    throw new ErreurMetier("Une joie se note de 1 à 10.");
  }
  const note = saisie.note?.trim() ? saisie.note.trim().slice(0, 280) : null;

  // Les déclencheurs viennent du formulaire : on ne garde que ceux qui
  // appartiennent vraiment à cette bande.
  const connus = await prisma.declencheur.findMany({
    where: { groupeId, id: { in: saisie.declencheurs } },
    select: { id: true },
  });

  const ligne = await prisma.entree.upsert({
    where: { membreId_jour: { membreId, jour } },
    create: {
      groupeId, membreId, jour, joie, note,
      declencheurs: { create: connus.map((d) => ({ declencheurId: d.id })) },
    },
    update: {
      joie, note,
      // Remplacer plutôt que fusionner : la case décochée doit disparaître.
      declencheurs: { deleteMany: {}, create: connus.map((d) => ({ declencheurId: d.id })) },
    },
    include: AVEC_TOUT,
  });

  await prisma.membre.update({ where: { id: membreId }, data: { vuLe: new Date() } });
  return versEntree(ligne);
}
