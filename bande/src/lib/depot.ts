import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { TAILLE_MAX_BANDE, TEINTES } from "./couleurs";
import { codeInvitation, creerCodeReprise, decouperCodeReprise, normaliserCode, verifierCodeReprise } from "./codes";
import { decaler } from "./dates";
import { LONGUEUR_PSEUDO, initialesDeLaBande } from "./initiales";
import type { Declencheur, Entree, FiltreFil, PageFil, Profil } from "./types";
import { MAX_ETIQUETTES, cleEtiquette, nettoyerEtiquette } from "./etiquettes";
import { DUREE_MAX_VIDEO, LONGUEUR_LEGENDE, MAX_MEDIAS, POIDS_MAX_MEDIA } from "./media";
import {
  cleAudio,
  cleMedia,
  ecrireOctets,
  lireOctets,
  stockageDistant,
  supprimerOctets,
} from "./stockage";
// Réexporté pour que la route d'export n'ait pas à savoir qu'il a déménagé.
export { versCsv } from "./csv";

/**
 * Tout ce qui touche la base passe par ici.
 *
 * Les fonctions rendent les types du domaine (`src/lib/types.ts`), jamais les
 * lignes Prisma : les écrans n'ont pas à savoir comment c'est rangé, et le jour
 * où le stockage change, il n'y a que ce fichier à rouvrir.
 */

export const DECLENCHEURS_PAR_DEFAUT = [
  { nom: "Biberon", emoji: "🍼" },
  { nom: "Marie Janne", emoji: "🌿" },
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
  etiquettes: { select: { etiquette: { select: { id: true, nom: true } } } },
  // Jamais les octets : charger une photo ou un son pour savoir qu'il existe
  // transformerait le fil en téléchargement de plusieurs méga-octets. Les
  // niveaux, eux, sont une soixantaine d'entiers — c'est la forme d'onde, et
  // elle doit être là dès le rendu.
  // Jamais `octets` ni `vignette` : ils pèsent des méga-octets, et chaque
  // écran du fil en chargerait des dizaines pour n'afficher que des adresses.
  photos: {
    select: { id: true, genre: true, largeur: true, hauteur: true, duree: true, legende: true },
    orderBy: { ordre: "asc" },
  },
  audio: { select: { duree: true, niveaux: true } },
  commentaires: {
    orderBy: { creeLe: "asc" },
    select: { id: true, texte: true, creeLe: true, membreId: true, membre: { select: { pseudo: true } } },
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
    titre: ligne.titre,
    note: ligne.note,
    energie: ligne.energie,
    calme: ligne.calme,
    declencheurs: ligne.declencheurs.map((d) => d.declencheurId),
    etiquettes: ligne.etiquettes.map((e) => e.etiquette),
    photos: ligne.photos.map((p) => ({
      id: p.id,
      genre: p.genre === "video" ? ("video" as const) : ("photo" as const),
      // Deux adresses : la vignette pour le fil, l'original pour le plein
      // écran. Les servir depuis la même route obligerait à choisir l'une ou
      // l'autre pour tout le monde.
      url: `/api/photo/${p.id}`,
      vignette: `/api/vignette/${p.id}`,
      largeur: p.largeur,
      hauteur: p.hauteur,
      duree: p.duree,
      legende: p.legende,
    })),
    audio: ligne.audio
      ? { url: `/api/audio/${ligne.id}`, duree: ligne.audio.duree, niveaux: ligne.audio.niveaux }
      : null,
    reactions: [...parEmoji].map(([emoji, parQui]) => ({ emoji, parQui })),
    commentaires: ligne.commentaires.map((c) => ({
      id: c.id,
      auteurId: c.membreId,
      auteur: c.membre.pseudo,
      texte: c.texte,
      quand: HEURE.format(c.creeLe),
    })),
    posteA: HEURE.format(ligne.creeLe),
    // L'heure affichée est formatée pour l'écran ; le repère « nouveau depuis
    // ta dernière visite » a besoin de l'instant brut, comparable.
    creeA: ligne.creeLe.toISOString(),
    epingle: ligne.epingle,
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
          // La teinte est unique dans une bande et suit l'ordre d'arrivée :
          // trier dessus donne un ordre stable, là où deux `creeLe` identiques
          // — le script de peuplement les crée d'un seul coup — laissent les
          // avatars changer de place d'un rendu à l'autre.
          // Sélection explicite, et ce n'est pas de la coquetterie : `include`
          // tire toutes les colonnes, donc les octets de chaque avatar, à
          // chaque chargement de chaque page. On ne veut savoir qu'une chose,
          // « y en a-t-il un », et ça se demande à part.
          membres: {
            orderBy: { teinte: "asc" },
            select: { id: true, pseudo: true, teinte: true },
          },
          declencheurs: { where: { actif: true }, orderBy: { ordre: "asc" } },
        },
      },
    },
  });
  if (!membre) return null;

  // Qui a une photo — sans en rapporter un seul octet.
  const avecAvatar = new Set(
    (
      await prisma.membre.findMany({
        where: { groupeId: membre.groupeId, avatar: { not: null } },
        select: { id: true },
      })
    ).map((m) => m.id),
  );

  const marques = initialesDeLaBande(membre.groupe.membres.map((m) => m.pseudo));
  const profils = membre.groupe.membres.map((m, index) => ({
    id: m.id,
    pseudo: m.pseudo,
    teinte: m.teinte,
    initiales: marques[index],
    avatar: avecAvatar.has(m.id) ? `/api/avatar/${m.id}` : null,
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

/**
 * Une page du fil : les `NOMBRE_JOURS` journées qui précèdent le curseur.
 *
 * Le fil paginait par tranche d'un tableau déjà chargé en entier — c'est le
 * défaut relevé à l'audit technique : ouvrir l'application chargeait cent
 * vingt journées avec leurs commentaires pour en afficher douze. Ici, deux
 * requêtes bornées, et rien de plus ne quitte la base.
 *
 * On pagine par **jour**, pas par entrée, parce que c'est le jour qui fait
 * l'unité à l'écran : couper au milieu d'une journée afficherait Momo sans
 * Sam sous le même titre, et la deuxième page rouvrirait la même date.
 */
export const JOURS_PAR_PAGE = 10;

function filtrerEntrees(filtre: FiltreFil | undefined): Prisma.EntreeWhereInput {
  switch (filtre?.genre) {
    // `some: {}` ne charge rien : c'est un EXISTS, pas une jointure ramenée.
    case "photo":
      return { photos: { some: { genre: "photo" } } };
    case "vocal":
      return { audio: { isNot: null } };
    case "personne":
      return { membreId: filtre.profil };
    default:
      return {};
  }
}

export async function listerPageDuFil(
  groupeId: string,
  options: { curseur?: string | null; filtre?: FiltreFil } = {},
): Promise<PageFil> {
  const conditions: Prisma.EntreeWhereInput = {
    groupeId,
    ...filtrerEntrees(options.filtre),
    ...(options.curseur ? { jour: { lt: options.curseur } } : {}),
  };

  // Un jour de plus que demandé : c'est ce qui dit s'il reste quelque chose
  // en dessous, sans compter la table entière à chaque page.
  const groupes = await prisma.entree.groupBy({
    by: ["jour"],
    where: conditions,
    orderBy: { jour: "desc" },
    take: JOURS_PAR_PAGE + 1,
  });

  const encore = groupes.length > JOURS_PAR_PAGE;
  const jours = groupes.slice(0, JOURS_PAR_PAGE).map((g) => g.jour);
  if (jours.length === 0) return { journees: [], curseur: null };

  // Les entrées des journées retenues — toutes, filtre compris : une journée
  // « avec photo » ne doit pas afficher les entrées sans photo de ce jour-là,
  // sinon le filtre ne filtre plus rien.
  const lignes = await prisma.entree.findMany({
    where: { groupeId, ...filtrerEntrees(options.filtre), jour: { in: jours } },
    orderBy: [{ jour: "desc" }, { creeLe: "asc" }],
    include: AVEC_TOUT,
  });

  const parJour = new Map<string, Entree[]>();
  for (const jour of jours) parJour.set(jour, []);
  for (const ligne of lignes) parJour.get(ligne.jour)?.push(versEntree(ligne));

  return {
    journees: jours.map((jour) => ({ jour, entrees: parJour.get(jour)! })),
    curseur: encore ? jours[jours.length - 1] : null,
  };
}

/**
 * Ai-je posé ma journée ?
 *
 * La question du voile, et elle se pose à chaque page du fil : elle mérite
 * donc une requête qui ne rapporte rien d'autre qu'un booléen.
 */
export async function aDejaPose(
  groupeId: string,
  membreId: string,
  jour: string,
): Promise<boolean> {
  const combien = await prisma.entree.count({ where: { groupeId, membreId, jour } });
  return combien > 0;
}

/** Les journées épinglées, hors pagination : elles restent en haut. */
export async function listerEpinglees(groupeId: string): Promise<Entree[]> {
  const lignes = await prisma.entree.findMany({
    where: { groupeId, epingle: true },
    orderBy: [{ jour: "desc" }, { creeLe: "asc" }],
    // Une bande qui épingle tout n'épingle rien, et le fil recommencerait à
    // charger sans borne. Douze, et le treizième remplace le plus ancien.
    take: 12,
    include: AVEC_TOUT,
  });
  return lignes.map(versEntree);
}

/**
 * Épingler ou décrocher une journée.
 *
 * Le `groupeId` est dans la condition, pas seulement dans la lecture : sans
 * lui, connaître l'identifiant d'une entrée suffirait à épingler la journée
 * d'une autre bande. C'est la règle de toute cette couche.
 */
export async function basculerEpingle(
  groupeId: string,
  entreeId: string,
): Promise<boolean> {
  const entree = await prisma.entree.findFirst({
    where: { id: entreeId, groupeId },
    select: { epingle: true },
  });
  if (!entree) return false;
  await prisma.entree.update({
    where: { id: entreeId },
    data: { epingle: !entree.epingle },
  });
  return !entree.epingle;
}

/**
 * La dernière ouverture du fil : on lit l'ancienne valeur, puis on écrit la
 * nouvelle. L'ordre compte — écrire d'abord effacerait le repère avant de
 * l'avoir affiché.
 */
export async function toucherVisiteDuFil(membreId: string): Promise<string | null> {
  const avant = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { filVuLe: true },
  });
  await prisma.membre.update({ where: { id: membreId }, data: { filVuLe: new Date() } });
  return avant?.filVuLe?.toISOString() ?? null;
}

export async function listerEntrees(groupeId: string, depuis?: string): Promise<Entree[]> {
  const lignes = await prisma.entree.findMany({
    where: { groupeId, ...(depuis ? { jour: { gte: depuis } } : {}) },
    orderBy: [{ jour: "desc" }, { creeLe: "asc" }],
    include: AVEC_TOUT,
  });
  return lignes.map(versEntree);
}

/**
 * Une entrée réduite à ce qu'on a le droit de montrer sous le voile.
 *
 * Flouter en CSS ne suffit pas, et de loin : le texte part quand même dans le
 * HTML, et les propriétés d'un composant client sont en plus sérialisées dans
 * la page pour l'hydratation. Un coup d'œil dans les outils du navigateur
 * suffisait donc à lire la journée des autres avant d'avoir posé la sienne.
 *
 * On ne retire pas la personne ni le jour : savoir QUI est passé est une
 * information neutre, et l'écran s'en sert pour dire qui manque à l'appel.
 * C'est le contenu qu'on garde.
 */
export function masquerEntree(entree: Entree): Entree {
  return {
    id: entree.id,
    jour: entree.jour,
    profil: entree.profil,
    joie: 0,
    titre: null,
    note: null,
    energie: null,
    calme: null,
    declencheurs: [],
    etiquettes: [],
    photos: [],
    audio: null,
    reactions: [],
    commentaires: [],
    posteA: "",
    // L'instant reste : savoir QUE quelqu'un est passé est déjà public sous le
    // voile (la figure du jour le montre), c'est le contenu qu'on cache.
    creeA: entree.creeA,
    epingle: entree.epingle,
  };
}

// ── Écrire ───────────────────────────────────────────────────────────────────

/** Trois mots. Au-delà, ce n'est plus un titre, c'est la note. */
export const LONGUEUR_TITRE = 60;

export type Saisie = {
  joie: number;
  note: string | null;
  declencheurs: string[];
  titre?: string | null;
  etiquettes?: string[];
  energie?: number | null;
  calme?: number | null;
  /** Le lieu venu de la géolocalisation, avec sa position déjà arrondie. */
  position?: { nom: string; latitude: number; longitude: number } | null;
};

/** Deux décimales, comme partout : environ un kilomètre. */
function arrondi(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

/**
 * Les deux curseurs secondaires.
 *
 * Ils sont facultatifs, et le restent : une journée sans énergie ni rire est
 * une journée complète. Une valeur hors bornes est ignorée plutôt que refusée —
 * un curseur mal câblé ne doit pas empêcher de poser sa journée.
 */
function auxiliaire(valeur: number | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  const arrondi = Math.round(valeur);
  if (!Number.isFinite(arrondi) || arrondi < 1 || arrondi > 10) return null;
  return arrondi;
}

export async function poserJournee(
  membreId: string,
  groupeId: string,
  jour: string,
  saisie: Saisie,
): Promise<Entree> {
  const joie = Math.round(saisie.joie);
  if (!Number.isFinite(joie) || joie < 1 || joie > 10) {
    throw new ErreurMetier("Une joie se note de 1 à 10.");
  }
  const note = saisie.note?.trim() ? saisie.note.trim().slice(0, 280) : null;
  const titre = saisie.titre?.trim() ? saisie.titre.trim().slice(0, LONGUEUR_TITRE) : null;
  const energie = auxiliaire(saisie.energie);
  const calme = auxiliaire(saisie.calme);

  // Les déclencheurs viennent du formulaire : on ne garde que ceux qui
  // appartiennent vraiment à cette bande.
  const connus = await prisma.declencheur.findMany({
    where: { groupeId, id: { in: saisie.declencheurs } },
    select: { id: true },
  });
  const etiquettes = await resoudreEtiquettes(groupeId, saisie.etiquettes ?? [], saisie.position);

  const ligne = await prisma.entree.upsert({
    where: { membreId_jour: { membreId, jour } },
    create: {
      groupeId, membreId, jour, joie, note, titre, energie, calme,
      declencheurs: { create: connus.map((d) => ({ declencheurId: d.id })) },
      etiquettes: { create: etiquettes.map((id) => ({ etiquetteId: id })) },
    },
    update: {
      joie, note, titre, energie, calme,
      // Remplacer plutôt que fusionner : la case décochée doit disparaître.
      declencheurs: { deleteMany: {}, create: connus.map((d) => ({ declencheurId: d.id })) },
      etiquettes: { deleteMany: {}, create: etiquettes.map((id) => ({ etiquetteId: id })) },
    },
    include: AVEC_TOUT,
  });

  await prisma.membre.update({ where: { id: membreId }, data: { vuLe: new Date() } });
  return versEntree(ligne);
}

// ── Réagir et commenter ──────────────────────────────────────────────────────

/**
 * Les émojis de réaction, fixes.
 *
 * Un sélecteur d'émoji complet transformerait le fil en concours de trouvailles ;
 * six touches suffisent à dire ce qu'on a à dire, et elles restent lisibles à
 * la taille d'une pastille.
 */
export const EMOJIS = ["❤️", "😂", "🔥", "🫂", "🙌", "👀"] as const;

/** Bascule : réagir deux fois avec le même émoji, c'est retirer sa réaction. */
export async function basculerReaction(membreId: string, entreeId: string, emoji: string) {
  if (!EMOJIS.includes(emoji as (typeof EMOJIS)[number])) {
    throw new ErreurMetier("Cet émoji n'est pas au menu.");
  }
  // L'entrée doit appartenir à la bande du membre : sans ce contrôle, un
  // identifiant deviné laisserait réagir chez les autres.
  const entree = await memeBande(membreId, entreeId);

  const existante = await prisma.reaction.findUnique({
    where: { entreeId_membreId_emoji: { entreeId, membreId, emoji } },
    select: { id: true },
  });
  if (existante) await prisma.reaction.delete({ where: { id: existante.id } });
  else await prisma.reaction.create({ data: { entreeId, membreId, emoji } });

  // Qui a écrit la journée, et si la réaction vient d'être POSÉE : l'appelant en
  // a besoin pour prévenir la bonne personne, et seulement quand il y a quelque
  // chose à annoncer. « Quelqu'un a retiré son cœur » n'intéresse personne.
  return { groupeId: entree.groupeId, auteurId: entree.membreId, pose: !existante };
}

export const LONGUEUR_COMMENTAIRE = 280;

export async function commenter(membreId: string, entreeId: string, texte: string) {
  const propre = texte.trim();
  if (!propre) throw new ErreurMetier("Un commentaire vide n'en est pas un.");
  const entree = await memeBande(membreId, entreeId);

  await prisma.commentaire.create({
    data: { entreeId, membreId, texte: propre.slice(0, LONGUEUR_COMMENTAIRE) },
  });
  return entree.groupeId;
}

/** On ne supprime que ses propres commentaires. */
export async function supprimerCommentaire(membreId: string, commentaireId: string) {
  const commentaire = await prisma.commentaire.findUnique({
    where: { id: commentaireId },
    select: { membreId: true, entree: { select: { groupeId: true } } },
  });
  if (!commentaire) throw new ErreurMetier("Ce commentaire n'existe plus.");
  if (commentaire.membreId !== membreId) throw new ErreurMetier("Ce commentaire n'est pas le tien.");

  await prisma.commentaire.delete({ where: { id: commentaireId } });
  return commentaire.entree.groupeId;
}

/**
 * Le droit de retrait, appliqué à une journée.
 *
 * Seul l'auteur retire la sienne. Ce n'est pas une exception au droit de
 * retrait du plan — il dit qu'un contenu part quand il gêne **celui qu'il
 * vise**, et une journée ne vise que celui qui l'a écrite. Les photos, le
 * vocal, les réactions et les commentaires partent avec elle : c'est la
 * cascade du schéma, pas une boucle à écrire ici.
 */
export async function supprimerEntree(membreId: string, entreeId: string) {
  const entree = await prisma.entree.findUnique({
    where: { id: entreeId },
    select: { membreId: true, groupeId: true },
  });
  if (!entree) throw new ErreurMetier("Cette journée n'existe plus.");
  if (entree.membreId !== membreId) {
    throw new ErreurMetier("On ne retire que ses propres journées.");
  }
  await prisma.entree.delete({ where: { id: entreeId } });
  return entree.groupeId;
}

/**
 * Vérifie qu'une entrée est bien dans la bande de la personne qui agit.
 *
 * Les identifiants sont des cuid, donc impossibles à deviner en pratique — mais
 * « impossible à deviner » n'est pas une autorisation, et c'est le genre de
 * contrôle qu'on n'ajoute jamais après coup.
 */
async function memeBande(membreId: string, entreeId: string) {
  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  const entree = await prisma.entree.findUnique({
    where: { id: entreeId },
    // L'auteur vient avec : c'est lui qu'on prévient d'une réaction, et le
    // relire dans une deuxième requête serait une requête pour rien.
    select: { groupeId: true, membreId: true },
  });
  if (!membre || !entree || membre.groupeId !== entree.groupeId) {
    throw new ErreurMetier("Cette journée n'est pas dans ta bande.");
  }
  return entree;
}

/**
 * Changer de pseudo.
 *
 * Le pseudo vit sur le membre, jamais recopié dans les journées : le changer
 * met donc à jour le passé en même temps que le présent, ce qui est bien ce
 * qu'on veut — on ne relit pas ses souvenirs sous un nom qu'on n'a plus.
 *
 * Même contrôle d'unicité qu'à l'arrivée dans la bande, à une exception près :
 * reprendre son propre nom en changeant seulement la casse doit passer.
 */
export async function renommerMembre(membreId: string, pseudo: string) {
  const nom = pseudo.trim();
  if (!nom) throw new ErreurMetier("Il faut bien un nom.");

  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!membre) throw new ErreurMetier("Ce compte n'existe plus.");

  const voisins = await prisma.membre.findMany({
    where: { groupeId: membre.groupeId, id: { not: membreId } },
    select: { pseudo: true },
  });
  const pris = voisins.find((m) => m.pseudo.toLowerCase() === nom.toLowerCase());
  if (pris) {
    throw new ErreurMetier(`« ${pris.pseudo} » est déjà pris dans cette bande. Prends une variante.`);
  }

  await prisma.membre.update({
    where: { id: membreId },
    data: { pseudo: nom.slice(0, LONGUEUR_PSEUDO) },
  });
}

/** Le côté de l'avatar stocké. Il n'est jamais affiché plus grand que 64 px. */
export const COTE_AVATAR = 256;
/** Au-delà, c'est que le recadrage du navigateur n'a pas eu lieu. */
const POIDS_MAX_AVATAR = 512 * 1024;

/** Sa photo de profil. Carrée et en JPEG : le navigateur s'en charge avant. */
export async function enregistrerAvatar(membreId: string, octets: Uint8Array<ArrayBuffer>) {
  if (octets.byteLength > POIDS_MAX_AVATAR) {
    throw new ErreurMetier("Cette image est trop lourde.");
  }
  await prisma.membre.update({ where: { id: membreId }, data: { avatar: octets } });
}

/** Revenir aux initiales. Elles ont toujours marché. */
export async function retirerAvatar(membreId: string) {
  await prisma.membre.update({ where: { id: membreId }, data: { avatar: null } });
}

/**
 * Les octets d'un avatar, pour la route qui les sert.
 *
 * Même règle que pour les médias : il faut une session, et appartenir à la
 * même bande. Une tête n'est pas plus publique qu'une photo de journée.
 */
export async function lireAvatar(demandeurId: string, membreId: string) {
  const [demandeur, cible] = await Promise.all([
    prisma.membre.findUnique({ where: { id: demandeurId }, select: { groupeId: true } }),
    prisma.membre.findUnique({ where: { id: membreId }, select: { groupeId: true, avatar: true } }),
  ]);
  if (!demandeur || !cible || demandeur.groupeId !== cible.groupeId) return null;
  return cible.avatar ?? null;
}

// ── Réglages de la bande ─────────────────────────────────────────────────────

export const LONGUEUR_NOM_BANDE = 40;
export const LONGUEUR_NOM_DECLENCHEUR = 24;
/** Au-delà, le formulaire du soir devient une liste de courses. */
export const MAX_DECLENCHEURS = 8;

export async function renommerBande(groupeId: string, nom: string) {
  const propre = nom.trim();
  if (!propre) throw new ErreurMetier("Une bande a besoin d'un nom.");
  await prisma.groupe.update({
    where: { id: groupeId },
    data: { nom: propre.slice(0, LONGUEUR_NOM_BANDE) },
  });
}

export async function reglerDevoilement(groupeId: string, reveler: boolean) {
  await prisma.groupe.update({ where: { id: groupeId }, data: { revelerApresPost: reveler } });
}

export async function ajouterDeclencheur(groupeId: string, nom: string, emoji: string) {
  const propre = nom.trim();
  if (!propre) throw new ErreurMetier("Donne un nom au déclencheur.");

  const actifs = await prisma.declencheur.count({ where: { groupeId, actif: true } });
  if (actifs >= MAX_DECLENCHEURS) {
    throw new ErreurMetier(
      `${MAX_DECLENCHEURS} déclencheurs, c'est déjà beaucoup à cocher tous les soirs. Désactives-en un.`,
    );
  }

  const dernier = await prisma.declencheur.findFirst({
    where: { groupeId },
    orderBy: { ordre: "desc" },
    select: { ordre: true },
  });

  await prisma.declencheur.create({
    data: {
      groupeId,
      nom: propre.slice(0, LONGUEUR_NOM_DECLENCHEUR),
      // Un émoji peut faire plusieurs points de code (drapeaux, familles) :
      // on découpe par grappes de graphèmes, pas par caractères.
      emoji: [...new Intl.Segmenter().segment(emoji.trim())].map((s) => s.segment)[0] ?? "•",
      ordre: (dernier?.ordre ?? -1) + 1,
    },
  });
}

/**
 * Désactiver plutôt que supprimer.
 *
 * Un déclencheur supprimé emporterait avec lui toutes les journées qui le
 * portaient, et l'historique des statistiques avec. On le retire du formulaire,
 * on garde le passé.
 */
export async function retirerDeclencheur(groupeId: string, declencheurId: string) {
  const declencheur = await prisma.declencheur.findUnique({
    where: { id: declencheurId },
    select: { groupeId: true },
  });
  if (!declencheur || declencheur.groupeId !== groupeId) {
    throw new ErreurMetier("Ce déclencheur n'est pas celui de ta bande.");
  }
  await prisma.declencheur.update({ where: { id: declencheurId }, data: { actif: false } });
}

// ── Photos et vidéos ────────────────────────────────────────────────────────

/**
 * Ce que le serveur accepte.
 *
 * Le navigateur redimensionne les photos et réencode les vidéos avant
 * d'envoyer ; ce plafond n'est donc pas la règle mais le garde-fou. Il compte
 * quand même : les médias vivent dans PostgreSQL, et l'offre gratuite de Neon
 * plafonne à un demi-giga-octet. Sans borne côté serveur, un navigateur où le
 * réencodage a échoué remplirait la base d'un seul envoi.
 */
export { MAX_MEDIAS, POIDS_MAX_MEDIA } from "./media";

const MIMES_PHOTO = ["image/jpeg", "image/webp", "image/png", "image/avif"];
/** Ce que produit le réencodage, et ce que les téléphones savent relire. */
const MIMES_VIDEO = ["video/mp4", "video/quicktime", "video/webm"];

async function maJournee(membreId: string, jour: string) {
  const entree = await prisma.entree.findUnique({
    where: { membreId_jour: { membreId, jour } },
    select: { id: true, groupeId: true },
  });
  // On n'illustre que sa propre journée, et seulement après l'avoir posée.
  if (!entree) throw new ErreurMetier("Pose ta journée avant d'y ajouter quelque chose.");
  return entree;
}

export type MediaEntrant = {
  genre: "photo" | "video";
  mime: string;
  octets: Uint8Array<ArrayBuffer>;
  largeur: number;
  hauteur: number;
  /** En millisecondes, pour une vidéo. */
  duree?: number | null;
  /** Fabriquée par le navigateur : WebP s'il sait, JPEG sinon. */
  vignette?: Uint8Array<ArrayBuffer> | null;
  mimeVignette?: string | null;
  legende?: string | null;
};

export async function ajouterMedia(membreId: string, jour: string, media: MediaEntrant) {
  const type = media.mime.split(";")[0].trim();
  const attendus = media.genre === "video" ? MIMES_VIDEO : MIMES_PHOTO;
  if (!attendus.includes(type)) {
    throw new ErreurMetier(
      media.genre === "video"
        ? "Ce format de vidéo n'est pas accepté."
        : "Ce format d'image n'est pas accepté.",
    );
  }
  if (media.octets.byteLength > POIDS_MAX_MEDIA) {
    throw new ErreurMetier(
      media.genre === "video"
        ? "Cette vidéo est trop lourde, même réduite. Essaie un extrait plus court."
        : "Cette image est trop lourde.",
    );
  }
  if (media.genre === "video" && (media.duree ?? 0) > DUREE_MAX_VIDEO + 2000) {
    throw new ErreurMetier("Huit secondes maximum.");
  }

  const entree = await maJournee(membreId, jour);
  const deja = await prisma.media.count({ where: { entreeId: entree.id } });
  if (deja >= MAX_MEDIAS) {
    throw new ErreurMetier(`${MAX_MEDIAS} par journée, c'est déjà un album.`);
  }

  // La ligne est créée d'abord, sans octets : son identifiant est la clé de
  // l'objet distant, et on ne peut pas écrire l'objet avant de le connaître.
  // L'ordre inverse — écrire chez R2 puis créer la ligne — laisserait un objet
  // orphelin à chaque échec d'insertion.
  const ligne = await prisma.media.create({
    data: {
      entreeId: entree.id,
      ordre: deja,
      genre: media.genre,
      mime: type,
      largeur: media.largeur,
      hauteur: media.hauteur,
      duree: media.genre === "video" ? Math.min(media.duree ?? 0, DUREE_MAX_VIDEO) : null,
      legende: nettoyerLegende(media.legende),
      // Le poids et l'empreinte sont écrits ici, une fois pour toutes : après
      // le déménagement chez R2 il faudrait retélécharger le fichier pour les
      // recalculer, et l'écran de stockage en a besoin à chaque affichage.
      poids: media.octets.byteLength,
      poidsVignette: media.vignette?.byteLength ?? 0,
      empreinte: createHash("sha256").update(media.octets).digest("hex"),
    },
    select: { id: true },
  });

  if (stockageDistant()) {
    try {
      const cle = await ecrireOctets(cleMedia(ligne.id), media.octets, type);
      const mimeVignette = typeVignette(media.mimeVignette);
      const cleVignette = media.vignette
        ? await ecrireOctets(cleMedia(ligne.id, true), media.vignette, mimeVignette)
        : null;
      await prisma.media.update({
        where: { id: ligne.id },
        data: { cle, cleVignette, mimeVignette: media.vignette ? mimeVignette : null },
      });
    } catch (erreur) {
      // R2 n'a pas voulu : la ligne repart avec. Une entrée sans octets ni clé
      // afficherait une case grise que personne ne saurait réparer.
      await prisma.media.delete({ where: { id: ligne.id } }).catch(() => {});
      throw erreur;
    }
  } else {
    await prisma.media.update({
      where: { id: ligne.id },
      data: {
        octets: media.octets,
        vignette: media.vignette ?? null,
        mimeVignette: media.vignette ? typeVignette(media.mimeVignette) : null,
      },
    });
  }

  return entree.groupeId;
}

/**
 * Le type d'une vignette, ramené à ce qu'on sait servir.
 *
 * Il vient du navigateur, donc du client : on ne le met pas tel quel dans un
 * en-tête `Content-Type`. Un type inconnu redevient du JPEG, qui est ce
 * qu'étaient toutes les vignettes jusqu'ici.
 */
function typeVignette(brut: string | null | undefined): string {
  const propre = brut?.split(";")[0].trim().toLowerCase();
  return propre && MIMES_PHOTO.includes(propre) ? propre : "image/jpeg";
}

function nettoyerLegende(brut: string | null | undefined): string | null {
  const propre = brut?.trim();
  return propre ? propre.slice(0, LONGUEUR_LEGENDE) : null;
}

/** On ne modifie que ses propres médias. Rendu : le groupe, pour rafraîchir. */
async function monMedia(membreId: string, mediaId: string) {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { entree: { select: { membreId: true, groupeId: true } } },
  });
  if (!media) throw new ErreurMetier("Ce média n'existe plus.");
  if (media.entree.membreId !== membreId) throw new ErreurMetier("Ce média n'est pas le tien.");
  return media.entree.groupeId;
}

export async function retirerMedia(membreId: string, mediaId: string) {
  const groupeId = await monMedia(membreId, mediaId);
  // Les clés se lisent AVANT la suppression : après, la ligne n'est plus là
  // pour dire où vivaient les octets, et l'objet resterait dans le seau sans
  // que rien ne s'en souvienne.
  const cles = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { cle: true, cleVignette: true },
  });
  await prisma.media.delete({ where: { id: mediaId } });
  await supprimerOctets(cles?.cle ?? null);
  await supprimerOctets(cles?.cleVignette ?? null);
  return groupeId;
}

export async function legender(membreId: string, mediaId: string, legende: string) {
  const groupeId = await monMedia(membreId, mediaId);
  await prisma.media.update({
    where: { id: mediaId },
    data: { legende: nettoyerLegende(legende) },
  });
  return groupeId;
}

/**
 * Les octets, pour la route qui les sert. Contrôle d'appartenance compris.
 *
 * `vignette` demande la version réduite : le fil et la galerie n'affichent
 * jamais l'original, et pour une vidéo la vignette est la seule chose qu'on
 * puisse mettre dans une mosaïque.
 */
export async function lireMedia(membreId: string, mediaId: string, vignette = false) {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: {
      mime: true,
      octets: vignette ? undefined : true,
      cle: vignette ? undefined : true,
      vignette: vignette ? true : undefined,
      cleVignette: vignette ? true : undefined,
      mimeVignette: vignette ? true : undefined,
      entree: { select: { groupeId: true } },
    },
  });
  if (!media) return null;

  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  // Le média d'une autre bande ne se sert pas, même avec le bon identifiant.
  // Le contrôle passe avant le moindre aller-retour vers R2 : on ne va pas
  // chercher des octets qu'on n'a pas le droit de rendre.
  if (!membre || membre.groupeId !== media.entree.groupeId) return null;

  if (vignette) {
    // Une vignette manquante n'est pas une erreur : les photos posées avant
    // l'arrivée des vignettes n'en ont pas. La route servira l'original.
    const octets = media.vignette ?? (await lireOctets(media.cleVignette ?? ""));
    // Les vignettes d'avant le lot M n'ont pas de type enregistré : elles sont
    // toutes en JPEG, et c'est ce que la colonne vide veut dire.
    return octets ? { mime: media.mimeVignette ?? "image/jpeg", octets } : null;
  }
  const octets = media.octets ?? (await lireOctets(media.cle ?? ""));
  return octets ? { mime: media.mime, octets } : null;
}

/**
 * Les médias de la bande, du plus récent au plus ancien.
 *
 * Sans les octets : la galerie n'affiche que des vignettes, et charger les
 * originaux pour construire une mosaïque ferait passer des dizaines de
 * méga-octets par le serveur pour rien.
 *
 * Et avec une borne. L'aperçu des souvenirs n'en montre que huit ; aller
 * chercher les mille de la bande pour en afficher huit, c'est un défaut qui ne
 * se voit pas la première année et qui devient une page qui ne charge plus la
 * cinquième.
 *
 * `membreId` restreint à une personne — c'est l'album du profil. Le filtre se
 * fait en base : ramener toute la bande pour en garder un quart, ce serait le
 * même défaut sous une autre forme.
 */
export async function mediasDeLaBande(groupeId: string, limite = 240, membreId?: string) {
  const lignes = await prisma.media.findMany({
    where: { entree: { groupeId, ...(membreId ? { membreId } : {}) } },
    take: limite,
    select: {
      id: true, genre: true, largeur: true, hauteur: true, duree: true, legende: true,
      entree: { select: { id: true, jour: true, membreId: true } },
    },
    orderBy: [{ entree: { jour: "desc" } }, { ordre: "asc" }],
  });
  return lignes.map((m) => ({
    id: m.id,
    genre: m.genre === "video" ? ("video" as const) : ("photo" as const),
    url: `/api/photo/${m.id}`,
    vignette: `/api/vignette/${m.id}`,
    largeur: m.largeur,
    hauteur: m.hauteur,
    duree: m.duree,
    legende: m.legende,
    jour: m.entree.jour,
    profil: m.entree.membreId,
    entreeId: m.entree.id,
  }));
}

/** Combien la bande en a en tout — pour dire s'il en reste au-delà de la borne. */
export async function compterMedias(groupeId: string) {
  return prisma.media.count({ where: { entree: { groupeId } } });
}

/**
 * L'espace occupé par la bande, pour l'afficher dans les réglages.
 *
 * `pg_column_size` mesure la valeur stockée, compression TOAST comprise :
 c'est ce que la base occupe vraiment, pas la taille du fichier d'origine.
 */
/**
 * La place occupée par la bande.
 *
 * On additionne les colonnes `poids`, pas la taille des colonnes d'octets :
 * une fois les fichiers chez R2, `pg_column_size` rendrait zéro et la jauge
 * annoncerait une base vide pendant que le seau se remplit.
 */
export async function espaceOccupe(groupeId: string) {
  const [medias] = await prisma.$queryRaw<{ octets: bigint | null; nombre: bigint }[]>`
    SELECT SUM(p.poids + p.poids_vignette)::bigint AS octets, COUNT(*)::bigint AS nombre
    FROM bande_photos p
    JOIN bande_entrees e ON e.id = p.entree_id
    WHERE e.groupe_id = ${groupeId}
  `;
  const [audios] = await prisma.$queryRaw<{ octets: bigint | null; nombre: bigint }[]>`
    SELECT SUM(a.poids)::bigint AS octets, COUNT(*)::bigint AS nombre
    FROM bande_audios a
    JOIN bande_entrees e ON e.id = a.entree_id
    WHERE e.groupe_id = ${groupeId}
  `;
  return {
    medias: { octets: Number(medias?.octets ?? 0), nombre: Number(medias?.nombre ?? 0) },
    audios: { octets: Number(audios?.octets ?? 0), nombre: Number(audios?.nombre ?? 0) },
  };
}

/**
 * Ce qu'il faut pour l'écran « Stockage » : qui, quoi, et ce qui pèse.
 *
 * Quatre requêtes agrégées, pas une ligne d'octets ramenée. Compter la place
 * en chargeant les fichiers serait le comble.
 *
 * Le **doublon** se reconnaît à son empreinte SHA-256, calculée à l'envoi. Deux
 * fichiers de même empreinte sont le même fichier, sans hésitation possible —
 * là où une comparaison sur le poids et les dimensions rendrait des faux
 * positifs que personne n'oserait effacer. Les médias d'avant le lot M n'en ont
 * pas si leurs octets étaient déjà partis : ils ne sortent simplement pas.
 */
export type AnalyseStockage = {
  parPersonne: { profil: string; octets: number; nombre: number }[];
  parType: { photos: number; videos: number; audios: number };
  plusGros: {
    id: string;
    jour: string;
    profil: string;
    genre: string;
    octets: number;
    legende: string | null;
  }[];
  doublons: {
    empreinte: string;
    octets: number;
    exemplaires: number;
    /** Tous sauf un : ce qu'on récupérerait en les retirant. */
    recuperable: number;
    /** Combien de copies en trop appartiennent à celui qui regarde. */
    miennes: number;
    ids: string[];
  }[];
};

export async function analyserStockage(
  groupeId: string,
  membreId: string,
): Promise<AnalyseStockage> {
  const parPersonne = await prisma.$queryRaw<
    { profil: string; octets: bigint | null; nombre: bigint }[]
  >`
    SELECT e.membre_id AS profil,
           SUM(COALESCE(p.poids, 0) + COALESCE(p.poids_vignette, 0) + COALESCE(a.poids, 0))::bigint AS octets,
           COUNT(p.id)::bigint AS nombre
    FROM bande_entrees e
    LEFT JOIN bande_photos p ON p.entree_id = e.id
    LEFT JOIN bande_audios a ON a.entree_id = e.id
    WHERE e.groupe_id = ${groupeId}
    GROUP BY e.membre_id
  `;

  const [types] = await prisma.$queryRaw<
    { photos: bigint | null; videos: bigint | null }[]
  >`
    SELECT SUM(CASE WHEN p.genre = 'video' THEN 0 ELSE p.poids + p.poids_vignette END)::bigint AS photos,
           SUM(CASE WHEN p.genre = 'video' THEN p.poids + p.poids_vignette ELSE 0 END)::bigint AS videos
    FROM bande_photos p
    JOIN bande_entrees e ON e.id = p.entree_id
    WHERE e.groupe_id = ${groupeId}
  `;
  const [sons] = await prisma.$queryRaw<{ octets: bigint | null }[]>`
    SELECT SUM(a.poids)::bigint AS octets
    FROM bande_audios a
    JOIN bande_entrees e ON e.id = a.entree_id
    WHERE e.groupe_id = ${groupeId}
  `;

  const plusGros = await prisma.$queryRaw<
    { id: string; jour: string; profil: string; genre: string; octets: bigint; legende: string | null }[]
  >`
    SELECT p.id, e.jour, e.membre_id AS profil, p.genre,
           (p.poids + p.poids_vignette)::bigint AS octets, p.legende
    FROM bande_photos p
    JOIN bande_entrees e ON e.id = p.entree_id
    WHERE e.groupe_id = ${groupeId}
    ORDER BY (p.poids + p.poids_vignette) DESC
    LIMIT 12
  `;

  const doublons = await prisma.$queryRaw<
    {
      empreinte: string;
      octets: bigint;
      exemplaires: bigint;
      ids: string[];
      auteurs: string[];
    }[]
  >`
    SELECT p.empreinte, MAX(p.poids)::bigint AS octets,
           COUNT(*)::bigint AS exemplaires,
           ARRAY_AGG(p.id ORDER BY p.cree_le) AS ids,
           ARRAY_AGG(e.membre_id ORDER BY p.cree_le) AS auteurs
    FROM bande_photos p
    JOIN bande_entrees e ON e.id = p.entree_id
    WHERE e.groupe_id = ${groupeId} AND p.empreinte IS NOT NULL
    GROUP BY p.empreinte
    HAVING COUNT(*) > 1
    ORDER BY MAX(p.poids) * (COUNT(*) - 1) DESC
    LIMIT 10
  `;

  return {
    parPersonne: parPersonne
      .map((l) => ({ profil: l.profil, octets: Number(l.octets ?? 0), nombre: Number(l.nombre) }))
      .sort((a, b) => b.octets - a.octets),
    parType: {
      photos: Number(types?.photos ?? 0),
      videos: Number(types?.videos ?? 0),
      audios: Number(sons?.octets ?? 0),
    },
    plusGros: plusGros.map((l) => ({ ...l, octets: Number(l.octets) })),
    doublons: doublons.map((l) => ({
      empreinte: l.empreinte,
      octets: Number(l.octets),
      exemplaires: Number(l.exemplaires),
      recuperable: Number(l.octets) * (Number(l.exemplaires) - 1),
      // Le premier envoyé reste : c'est celui qui porte les réactions et les
      // commentaires, et l'effacer ferait disparaître une conversation.
      ids: l.ids.slice(1),
      // Compté ici plutôt que dans le SQL : la même tranche « tout sauf le
      // premier » sert aux deux, et la dupliquer en agrégat ferait diverger
      // les deux définitions au premier changement.
      miennes: l.auteurs.slice(1).filter((a) => a === membreId).length,
    })),
  };
}

/**
 * Retirer les copies d'un même fichier, en gardant la première.
 *
 * Deux garde-fous, et ils viennent du même endroit — on efface des souvenirs :
 *
 * · **la plus ancienne reste**, toujours. C'est elle qui porte les réactions et
 *   les commentaires ; effacer celle-là ferait disparaître une conversation
 *   pour économiser quarante kilo-octets ;
 * · **on ne retire que les siennes.** La règle vaut partout ailleurs dans ce
 *   fichier, elle vaut ici : libérer de la place n'est pas une raison de
 *   toucher à la journée de quelqu'un d'autre. Le compte rendu dit combien
 *   de copies appartiennent à d'autres, pour que l'écran puisse le dire aussi.
 */
export async function retirerCopies(
  membreId: string,
  groupeId: string,
  empreinte: string,
): Promise<{ retires: number; octets: number; laissees: number }> {
  const copies = await prisma.media.findMany({
    where: { empreinte, entree: { groupeId } },
    select: {
      id: true,
      poids: true,
      poidsVignette: true,
      cle: true,
      cleVignette: true,
      entree: { select: { membreId: true } },
    },
    orderBy: { creeLe: "asc" },
  });
  if (copies.length < 2) return { retires: 0, octets: 0, laissees: 0 };

  const [, ...suivantes] = copies;
  const miennes = suivantes.filter((c) => c.entree.membreId === membreId);

  for (const copie of miennes) {
    await prisma.media.delete({ where: { id: copie.id } });
    await supprimerOctets(copie.cle);
    await supprimerOctets(copie.cleVignette);
  }

  return {
    retires: miennes.length,
    octets: miennes.reduce((s, c) => s + c.poids + c.poidsVignette, 0),
    laissees: suivantes.length - miennes.length,
  };
}

// ── Note vocale ─────────────────────────────────────────────────────────────

/** Trente secondes. Au-delà, ce n'est plus une note, c'est un message. */
export const DUREE_MAX_AUDIO = 30_000;
export const POIDS_MAX_AUDIO = 2 * 1024 * 1024;
/**
 * Les formats acceptés.
 *
 * Safari produit du MP4/AAC, Chrome et Firefox du WebM/Opus. Le navigateur
 * choisit à l'enregistrement — coder un format en dur ferait échouer
 * l'enregistrement sur la moitié des téléphones, et sur iPhone en particulier.
 */
const MIMES_AUDIO = ["audio/mp4", "audio/aac", "audio/webm", "audio/ogg", "audio/mpeg"];

export async function enregistrerAudio(
  membreId: string,
  jour: string,
  son: { mime: string; octets: Uint8Array<ArrayBuffer>; duree: number; niveaux: number[] },
) {
  const type = son.mime.split(";")[0].trim();
  if (!MIMES_AUDIO.includes(type)) throw new ErreurMetier("Ce format de son n'est pas accepté.");
  if (son.octets.byteLength > POIDS_MAX_AUDIO) throw new ErreurMetier("Ce son est trop lourd.");
  if (son.duree > DUREE_MAX_AUDIO + 2000) throw new ErreurMetier("Trente secondes maximum.");

  const entree = await maJournee(membreId, jour);
  const donnees = {
    mime: type,
    duree: Math.min(son.duree, DUREE_MAX_AUDIO),
    poids: son.octets.byteLength,
    // Une soixantaine de barres suffit à dessiner une onde lisible ; en garder
    // mille ferait grossir chaque page du fil pour rien.
    niveaux: son.niveaux.slice(0, 64).map((n) => Math.max(0, Math.min(100, Math.round(n)))),
  };
  if (stockageDistant()) {
    // L'audio se range sous l'identifiant de la JOURNÉE, pas le sien : il y en
    // a au plus un par journée, et réenregistrer écrase l'objet précédent au
    // lieu d'en laisser un orphelin à chaque prise.
    const cle = await ecrireOctets(cleAudio(entree.id), son.octets, type);
    await prisma.audio.upsert({
      where: { entreeId: entree.id },
      create: { entreeId: entree.id, ...donnees, cle },
      update: { ...donnees, cle },
    });
  } else {
    await prisma.audio.upsert({
      where: { entreeId: entree.id },
      create: { entreeId: entree.id, ...donnees, octets: son.octets },
      update: { ...donnees, octets: son.octets },
    });
  }
  return entree.groupeId;
}

export async function retirerAudio(membreId: string, jour: string) {
  const entree = await maJournee(membreId, jour);
  const audio = await prisma.audio.findUnique({
    where: { entreeId: entree.id },
    select: { cle: true },
  });
  await prisma.audio.deleteMany({ where: { entreeId: entree.id } });
  await supprimerOctets(audio?.cle ?? null);
  return entree.groupeId;
}

export async function lireAudio(membreId: string, entreeId: string) {
  const audio = await prisma.audio.findUnique({
    where: { entreeId },
    select: { mime: true, octets: true, cle: true, entree: { select: { groupeId: true } } },
  });
  if (!audio) return null;

  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!membre || membre.groupeId !== audio.entree.groupeId) return null;

  const octets = audio.octets ?? (await lireOctets(audio.cle ?? ""));
  return octets ? { mime: audio.mime, octets } : null;
}

// ── Étiquettes ──────────────────────────────────────────────────────────────

/** Celles que la bande a déjà utilisées, les plus fréquentes d'abord. */
export async function etiquettesDeLaBande(groupeId: string) {
  const lignes = await prisma.etiquette.findMany({
    where: { groupeId },
    select: {
      id: true, nom: true, latitude: true, longitude: true,
      _count: { select: { entrees: true } },
    },
  });
  return lignes
    .sort((a, b) => b._count.entrees - a._count.entrees || a.nom.localeCompare(b.nom))
    .map((e) => ({
      id: e.id, nom: e.nom, usages: e._count.entrees,
      latitude: e.latitude, longitude: e.longitude,
    }));
}

/** Trouve ou crée les étiquettes d'une journée, et rend leurs identifiants. */
async function resoudreEtiquettes(
  groupeId: string,
  noms: string[],
  /**
   * La position d'un lieu venu du bouton « utiliser ma position ». Elle est
   * déjà arrondie par la route qui l'a nommé — on ne la ré-arrondit pas ici,
   * on refuse simplement de la stocker si elle ne l'est pas.
   */
  position?: { nom: string; latitude: number; longitude: number } | null,
): Promise<string[]> {
  const propres = [...new Set(
    noms.map(nettoyerEtiquette).filter((n) => cleEtiquette(n).length > 0),
  )].slice(0, MAX_ETIQUETTES);

  const ids: string[] = [];
  for (const nom of propres) {
    const cle = cleEtiquette(nom);
    // `upsert` plutôt que « chercher puis créer » : deux personnes qui posent la
    // même étiquette au même moment ne doivent pas se marcher dessus.
    // La position ne se pose que sur le lieu qu'elle nomme, et une seule fois :
    // le premier qui géolocalise « Le canal » le place, les suivants n'y
    // touchent pas. Sans ce `update` conditionnel, chaque personne
    // repositionnerait le lieu commun sur son propre kilomètre.
    const situe =
      position && cleEtiquette(position.nom) === cle
        ? { latitude: arrondi(position.latitude), longitude: arrondi(position.longitude) }
        : null;

    const etiquette = await prisma.etiquette.upsert({
      where: { groupeId_cle: { groupeId, cle } },
      create: { groupeId, cle, nom, ...(situe ?? {}) },
      update: {},
      select: { id: true, latitude: true },
    });
    if (situe && etiquette.latitude === null) {
      await prisma.etiquette.update({ where: { id: etiquette.id }, data: situe });
    }
    ids.push(etiquette.id);
  }
  return ids;
}

// ── Synchronisation ─────────────────────────────────────────────────────────

/**
 * Une empreinte de l'état de la bande, à comparer d'un sondage à l'autre.
 *
 * Compter et prendre le dernier horodatage coûte trois agrégats, là où
 * relire le fil coûterait tout le fil. C'est ce qui rend acceptable un sondage
 * toutes les trois secondes sur une base gratuite.
 */
export async function versionBande(groupeId: string): Promise<string> {
  const [entrees, reactions, commentaires, photos, audios, membres] = await Promise.all([
    prisma.entree.aggregate({ where: { groupeId }, _count: true, _max: { modifieLe: true } }),
    prisma.reaction.aggregate({ where: { entree: { groupeId } }, _count: true, _max: { creeLe: true } }),
    prisma.commentaire.aggregate({ where: { entree: { groupeId } }, _count: true, _max: { creeLe: true } }),
    // Les photos comptent au même titre : ajouter une image ne touche à aucun
    // des autres agrégats, et elle resterait invisible chez les autres.
    prisma.media.aggregate({ where: { entree: { groupeId } }, _count: true, _max: { modifieLe: true } }),
    // Les notes vocales pour la même raison, et elle n'est pas théorique :
    // enregistrer un son ne modifie pas la ligne de la journée, donc sans cet
    // agrégat la note resterait muette sur les autres téléphones jusqu'à ce
    // qu'une réaction ou un commentaire vienne remuer l'empreinte.
    prisma.audio.aggregate({ where: { entree: { groupeId } }, _count: true, _max: { modifieLe: true } }),
    // Et les membres : quelqu'un qui rejoint, qui part, qui change de nom ou de
    // photo change l'écran de tout le monde. D'où `modifieLe` et non `creeLe` —
    // un renommage ne crée personne.
    prisma.membre.aggregate({ where: { groupeId }, _count: true, _max: { modifieLe: true } }),
  ]);

  // Les capsules aussi : en écrire une change l'écran des souvenirs de tout le
  // monde. Leur ouverture, elle, dépend de la date et non d'une écriture — le
  // rendu du serveur s'en charge au prochain passage.
  const capsules = await prisma.capsule.aggregate({
    where: { groupeId }, _count: true, _max: { creeLe: true },
  });

  return [
    entrees._count, entrees._max.modifieLe?.getTime() ?? 0,
    reactions._count, reactions._max.creeLe?.getTime() ?? 0,
    commentaires._count, commentaires._max.creeLe?.getTime() ?? 0,
    photos._count, photos._max.modifieLe?.getTime() ?? 0,
    audios._count, audios._max.modifieLe?.getTime() ?? 0,
    membres._count, membres._max.modifieLe?.getTime() ?? 0,
    capsules._count, capsules._max.creeLe?.getTime() ?? 0,
  ].join("-");
}

// ── Partir, et emporter ses affaires ────────────────────────────────────────

/**
 * Tout ce que la bande a écrit, dans une seule structure.
 *
 * Exporter n'est pas une fonctionnalité de confort : c'est ce qui fait qu'on
 * peut partir. Une application où les données ne sortent pas est une
 * application qui vous retient.
 */
export async function exporter(groupeId: string) {
  const groupe = await prisma.groupe.findUnique({
    where: { id: groupeId },
    include: {
      membres: { orderBy: { teinte: "asc" }, select: { id: true, pseudo: true, teinte: true, creeLe: true } },
      declencheurs: { orderBy: { ordre: "asc" }, select: { id: true, nom: true, emoji: true, actif: true } },
      entrees: {
        orderBy: [{ jour: "asc" }, { creeLe: "asc" }],
        include: AVEC_TOUT,
      },
    },
  });
  if (!groupe) throw new ErreurMetier("Cette bande n'existe plus.");

  const pseudo = new Map(groupe.membres.map((m) => [m.id, m.pseudo]));
  const declencheur = new Map(groupe.declencheurs.map((d) => [d.id, d.nom]));

  return {
    bande: groupe.nom,
    exporteLe: new Date().toISOString(),
    membres: groupe.membres.map((m) => ({ pseudo: m.pseudo, teinte: m.teinte, arriveLe: m.creeLe })),
    declencheurs: groupe.declencheurs.map((d) => ({ nom: d.nom, emoji: d.emoji, actif: d.actif })),
    journees: groupe.entrees.map((e) => ({
      jour: e.jour,
      qui: pseudo.get(e.membreId) ?? "?",
      joie: e.joie,
      note: e.note,
      declencheurs: e.declencheurs.map((d) => declencheur.get(d.declencheurId) ?? "?"),
      photos: e.photos.length,
      vocal: e.audio !== null,
      titre: e.titre,
      etiquettes: e.etiquettes.map((x) => x.etiquette.nom),
      energie: e.energie,
      calme: e.calme,
      reactions: e.reactions.map((r) => ({ emoji: r.emoji, de: pseudo.get(r.membreId) ?? "?" })),
      commentaires: e.commentaires.map((c) => ({
        de: c.membre.pseudo, texte: c.texte, quand: c.creeLe,
      })),
      posteLe: e.creeLe,
    })),
  };
}


/**
 * Quitter la bande.
 *
 * Les journées partent avec la personne : ce sont les siennes. Les cascades
 * emportent aussi ses réactions et ses commentaires. La dernière personne à
 * partir emporte la bande elle-même — un groupe vide n'a personne pour y
 * revenir, et son code d'invitation resterait valide dans le vide.
 */
export async function quitterBande(membreId: string) {
  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!membre) return;

  await prisma.membre.delete({ where: { id: membreId } });
  const restants = await prisma.membre.count({ where: { groupeId: membre.groupeId } });
  if (restants === 0) await prisma.groupe.delete({ where: { id: membre.groupeId } });
}

// ── Capsules temporelles ────────────────────────────────────────────────────

export const LONGUEUR_CAPSULE = 1000;
/** Une capsule qu'on peut ouvrir demain n'est pas une capsule. */
export const DELAI_MIN_CAPSULE = 7;

export type Capsule = {
  id: string;
  auteur: string;
  auteurId: string;
  genre: "mot" | "photo" | "video" | "audio";
  ouvrirLe: string;
  creeLe: string;
  /** Absent tant que la date n'est pas venue : le serveur ne l'envoie pas. */
  texte: string | null;
  /** L'adresse du contenu, uniquement une fois ouvert. */
  url: string | null;
  /** L'aperçu flouté, lui, se montre avant : c'est tout l'intérêt du sablier. */
  apercu: string | null;
  duree: number | null;
  mienne: boolean;
};

const GENRES_SCELLE = ["mot", "photo", "video", "audio"] as const;
export type GenreScelle = (typeof GENRES_SCELLE)[number];

export async function ecrireCapsule(
  membreId: string,
  groupeId: string,
  texte: string,
  ouvrirLe: string,
  aujourdhui: string,
  contenu?: {
    genre: GenreScelle;
    octets: Uint8Array<ArrayBuffer>;
    mime: string;
    /**
     * L'aperçu est flouté À LA FABRICATION, dans le navigateur, avant l'envoi.
     * Envoyer l'image nette et la flouter en CSS reviendrait à la donner et à
     * demander poliment de ne pas regarder — c'est exactement l'erreur que le
     * voile du fil a déjà coûtée une fois.
     */
    apercu: Uint8Array<ArrayBuffer>;
    duree: number | null;
  },
) {
  const propre = texte.trim();
  if (!propre) throw new ErreurMetier("Écris quelque chose à ouvrir plus tard.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ouvrirLe)) throw new ErreurMetier("Cette date n'a pas la bonne forme.");

  // Le contrôle est ici et pas seulement dans le formulaire : le champ `min`
  // d'un sélecteur de date se contourne en trois secondes.
  const minimum = decaler(aujourdhui, DELAI_MIN_CAPSULE);
  if (ouvrirLe < minimum) {
    throw new ErreurMetier(`Choisis une date d'au moins ${DELAI_MIN_CAPSULE} jours — sinon ce n'est pas une capsule.`);
  }

  await prisma.capsule.create({
    data: {
      groupeId, membreId, ouvrirLe,
      genre: contenu?.genre ?? "mot",
      texte: propre.slice(0, LONGUEUR_CAPSULE),
      octets: contenu?.octets ?? null,
      mime: contenu?.mime ?? null,
      apercu: contenu?.apercu ?? null,
      duree: contenu?.duree ?? null,
    },
  });
}

export async function listerCapsules(
  groupeId: string,
  membreId: string,
  aujourdhui: string,
): Promise<Capsule[]> {
  const lignes = await prisma.capsule.findMany({
    where: { groupeId },
    orderBy: { ouvrirLe: "asc" },
    // Jamais `octets` : ils passent par une route, et un scellé vidéo dans une
    // liste ferait transiter des méga-octets pour afficher un sablier.
    select: {
      id: true, genre: true, ouvrirLe: true, creeLe: true, texte: true,
      duree: true, membreId: true,
      membre: { select: { pseudo: true } },
    },
  });

  return lignes.map((c) => {
    const ouvert = c.ouvrirLe <= aujourdhui;
    return {
      id: c.id,
      auteur: c.membre.pseudo,
      auteurId: c.membreId,
      genre: (GENRES_SCELLE as readonly string[]).includes(c.genre)
        ? (c.genre as GenreScelle)
        : "mot",
      ouvrirLe: c.ouvrirLe,
      creeLe: c.creeLe.toISOString().slice(0, 10),
      // Scellé : le texte ne quitte pas le serveur. Le cacher côté client
      // reviendrait à l'envoyer et à demander poliment de ne pas regarder.
      texte: ouvert ? c.texte : null,
      url: ouvert && c.genre !== "mot" ? `/api/scelle/${c.id}` : null,
      apercu: c.genre !== "mot" ? `/api/scelle/${c.id}/apercu` : null,
      duree: c.duree,
      mienne: c.membreId === membreId,
    };
  });
}

/**
 * Les octets d'un scellé, pour les routes qui les servent.
 *
 * `apercu` est servi avant l'ouverture — il est déjà flouté dans les octets.
 * Le contenu, lui, exige que la date soit venue : le contrôle est ici, pas
 * dans l'écran, parce qu'une adresse se tape à la main.
 */
export async function lireScelle(membreId: string, capsuleId: string, aujourdhui: string, apercu = false) {
  const capsule = await prisma.capsule.findUnique({
    where: { id: capsuleId },
    select: {
      groupeId: true, ouvrirLe: true, mime: true,
      octets: apercu ? undefined : true,
      apercu: apercu ? true : undefined,
    },
  });
  if (!capsule) return null;

  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!membre || membre.groupeId !== capsule.groupeId) return null;

  if (apercu) {
    return capsule.apercu ? { mime: "image/jpeg", octets: capsule.apercu } : null;
  }
  // Pas encore l'heure : rien, même pour celui qui l'a scellé. Un scellé qu'on
  // peut rouvrir soi-même n'est pas un scellé.
  if (capsule.ouvrirLe > aujourdhui) return null;
  return capsule.octets && capsule.mime ? { mime: capsule.mime, octets: capsule.octets } : null;
}

export async function supprimerCapsule(membreId: string, capsuleId: string) {
  const capsule = await prisma.capsule.findUnique({
    where: { id: capsuleId },
    select: { membreId: true },
  });
  if (!capsule) throw new ErreurMetier("Cette capsule n'existe plus.");
  if (capsule.membreId !== membreId) throw new ErreurMetier("Cette capsule n'est pas la tienne.");
  await prisma.capsule.delete({ where: { id: capsuleId } });
}

// ── Le pouls ────────────────────────────────────────────────────────────────

export { REPOS as REPOS_POULS } from "./pouls";

/**
 * Poser un pouls.
 *
 * **Un anti-rebond de cinq minutes**, et ce n'est pas de la prudence : les
 * deux curseurs sont à portée de pouce sur l'écran d'accueil, et sans ça une
 * poche fait quarante relevés identiques qui écrasent la courbe de la journée.
 * Un pouls reposté dans les cinq minutes REMPLACE le précédent — c'est ce
 * qu'on veut quand on corrige un curseur qu'on a mal lâché.
 */
export async function poserPouls(
  membreId: string,
  groupeId: string,
  jour: string,
  valeurs: { rire: number; energie: number },
) {
  const { borner, REPOS } = await import("./pouls");
  const dernier = await prisma.pouls.findFirst({
    where: { groupeId, membreId, jour },
    orderBy: { poseA: "desc" },
  });

  const data = {
    rire: borner(valeurs.rire),
    energie: borner(valeurs.energie),
    poseA: new Date(),
  };

  if (dernier && Date.now() - dernier.poseA.getTime() < REPOS) {
    await prisma.pouls.update({ where: { id: dernier.id }, data });
    return;
  }
  await prisma.pouls.create({ data: { ...data, groupeId, membreId, jour } });
}

/**
 * Les pouls de la bande, sur une fenêtre.
 *
 * Bornée par `depuis` : le graphique ne montre jamais plus de sept jours, et
 * tout charger pour n'en dessiner sept serait la même erreur que celle notée
 * dans l'audit technique.
 */
export async function poulsDeLaBande(groupeId: string, depuis: string) {
  const lignes = await prisma.pouls.findMany({
    where: { groupeId, jour: { gte: depuis } },
    orderBy: { poseA: "asc" },
    select: { membreId: true, jour: true, rire: true, energie: true, poseA: true },
  });
  return lignes.map((l) => ({
    membreId: l.membreId,
    jour: l.jour,
    rire: l.rire,
    energie: l.energie,
    poseA: l.poseA.toISOString(),
  }));
}
