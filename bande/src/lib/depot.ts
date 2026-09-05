import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { TAILLE_MAX_BANDE, TEINTES } from "./couleurs";
import { codeInvitation, creerCodeReprise, decouperCodeReprise, normaliserCode, verifierCodeReprise } from "./codes";
import { decaler } from "./dates";
import { initialesDeLaBande } from "./initiales";
import type { Declencheur, Entree, Profil } from "./types";
import { MAX_ETIQUETTES, cleEtiquette, nettoyerEtiquette } from "./etiquettes";
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
  etiquettes: { select: { etiquette: { select: { id: true, nom: true } } } },
  // Jamais les octets : charger une photo ou un son pour savoir qu'il existe
  // transformerait le fil en téléchargement de plusieurs méga-octets. Les
  // niveaux, eux, sont une soixantaine d'entiers — c'est la forme d'onde, et
  // elle doit être là dès le rendu.
  photos: { select: { id: true, largeur: true, hauteur: true }, orderBy: { ordre: "asc" } },
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
      url: `/api/photo/${p.id}`,
      largeur: p.largeur,
      hauteur: p.hauteur,
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
          membres: { orderBy: { teinte: "asc" } },
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
};

/**
 * Les deux curseurs secondaires.
 *
 * Ils sont facultatifs, et le restent : une journée sans énergie ni calme est
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
  const etiquettes = await resoudreEtiquettes(groupeId, saisie.etiquettes ?? []);

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

  return entree.groupeId;
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
    select: { groupeId: true },
  });
  if (!membre || !entree || membre.groupeId !== entree.groupeId) {
    throw new ErreurMetier("Cette journée n'est pas dans ta bande.");
  }
  return entree;
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

// ── Photos ──────────────────────────────────────────────────────────────────

/** Au-delà, c'est que le redimensionnement du navigateur n'a pas eu lieu. */
export const POIDS_MAX_PHOTO = 2 * 1024 * 1024;
/** Assez pour raconter une journée, pas assez pour en faire un album. */
export const MAX_PHOTOS = 4;
const MIMES_PHOTO = ["image/jpeg", "image/webp", "image/png"];

async function maJournee(membreId: string, jour: string) {
  const entree = await prisma.entree.findUnique({
    where: { membreId_jour: { membreId, jour } },
    select: { id: true, groupeId: true },
  });
  // On n'illustre que sa propre journée, et seulement après l'avoir posée.
  if (!entree) throw new ErreurMetier("Pose ta journée avant d'y ajouter quelque chose.");
  return entree;
}

export async function ajouterPhoto(
  membreId: string,
  jour: string,
  fichier: { mime: string; octets: Uint8Array<ArrayBuffer>; largeur: number; hauteur: number },
) {
  if (!MIMES_PHOTO.includes(fichier.mime)) {
    throw new ErreurMetier("Ce format d'image n'est pas accepté.");
  }
  if (fichier.octets.byteLength > POIDS_MAX_PHOTO) {
    throw new ErreurMetier("Cette image est trop lourde.");
  }

  const entree = await maJournee(membreId, jour);
  const deja = await prisma.photo.count({ where: { entreeId: entree.id } });
  if (deja >= MAX_PHOTOS) {
    throw new ErreurMetier(`${MAX_PHOTOS} photos par journée, c'est déjà un album.`);
  }

  await prisma.photo.create({ data: { entreeId: entree.id, ordre: deja, ...fichier } });
  return entree.groupeId;
}

/** On ne retire que ses propres photos. */
export async function retirerPhoto(membreId: string, photoId: string) {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: { entree: { select: { membreId: true, groupeId: true } } },
  });
  if (!photo) throw new ErreurMetier("Cette photo n'existe plus.");
  if (photo.entree.membreId !== membreId) throw new ErreurMetier("Cette photo n'est pas la tienne.");

  await prisma.photo.delete({ where: { id: photoId } });
  return photo.entree.groupeId;
}

/** Les octets, pour la route qui les sert. Contrôle d'appartenance compris. */
export async function lirePhoto(membreId: string, photoId: string) {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: { mime: true, octets: true, entree: { select: { groupeId: true } } },
  });
  if (!photo) return null;

  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  // La photo d'une autre bande ne se sert pas, même avec le bon identifiant.
  if (!membre || membre.groupeId !== photo.entree.groupeId) return null;

  return { mime: photo.mime, octets: photo.octets };
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
    octets: son.octets,
    duree: Math.min(son.duree, DUREE_MAX_AUDIO),
    // Une soixantaine de barres suffit à dessiner une onde lisible ; en garder
    // mille ferait grossir chaque page du fil pour rien.
    niveaux: son.niveaux.slice(0, 64).map((n) => Math.max(0, Math.min(100, Math.round(n)))),
  };
  await prisma.audio.upsert({
    where: { entreeId: entree.id },
    create: { entreeId: entree.id, ...donnees },
    update: donnees,
  });
  return entree.groupeId;
}

export async function retirerAudio(membreId: string, jour: string) {
  const entree = await maJournee(membreId, jour);
  await prisma.audio.deleteMany({ where: { entreeId: entree.id } });
  return entree.groupeId;
}

export async function lireAudio(membreId: string, entreeId: string) {
  const audio = await prisma.audio.findUnique({
    where: { entreeId },
    select: { mime: true, octets: true, entree: { select: { groupeId: true } } },
  });
  if (!audio) return null;

  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!membre || membre.groupeId !== audio.entree.groupeId) return null;

  return { mime: audio.mime, octets: audio.octets };
}

// ── Étiquettes ──────────────────────────────────────────────────────────────

/** Celles que la bande a déjà utilisées, les plus fréquentes d'abord. */
export async function etiquettesDeLaBande(groupeId: string) {
  const lignes = await prisma.etiquette.findMany({
    where: { groupeId },
    select: { id: true, nom: true, _count: { select: { entrees: true } } },
  });
  return lignes
    .sort((a, b) => b._count.entrees - a._count.entrees || a.nom.localeCompare(b.nom))
    .map((e) => ({ id: e.id, nom: e.nom, usages: e._count.entrees }));
}

/** Trouve ou crée les étiquettes d'une journée, et rend leurs identifiants. */
async function resoudreEtiquettes(groupeId: string, noms: string[]): Promise<string[]> {
  const propres = [...new Set(
    noms.map(nettoyerEtiquette).filter((n) => cleEtiquette(n).length > 0),
  )].slice(0, MAX_ETIQUETTES);

  const ids: string[] = [];
  for (const nom of propres) {
    const cle = cleEtiquette(nom);
    // `upsert` plutôt que « chercher puis créer » : deux personnes qui posent la
    // même étiquette au même moment ne doivent pas se marcher dessus.
    const etiquette = await prisma.etiquette.upsert({
      where: { groupeId_cle: { groupeId, cle } },
      create: { groupeId, cle, nom },
      update: {},
      select: { id: true },
    });
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
    prisma.photo.aggregate({ where: { entree: { groupeId } }, _count: true, _max: { modifieLe: true } }),
    // Les notes vocales pour la même raison, et elle n'est pas théorique :
    // enregistrer un son ne modifie pas la ligne de la journée, donc sans cet
    // agrégat la note resterait muette sur les autres téléphones jusqu'à ce
    // qu'une réaction ou un commentaire vienne remuer l'empreinte.
    prisma.audio.aggregate({ where: { entree: { groupeId } }, _count: true, _max: { modifieLe: true } }),
    // Et les membres : quelqu'un qui rejoint ou qui part change l'écran de tout
    // le monde.
    prisma.membre.aggregate({ where: { groupeId }, _count: true, _max: { creeLe: true } }),
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
    membres._count, membres._max.creeLe?.getTime() ?? 0,
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
  ouvrirLe: string;
  creeLe: string;
  /** Absent tant que la date n'est pas venue : le serveur ne l'envoie pas. */
  texte: string | null;
  mienne: boolean;
};

export async function ecrireCapsule(
  membreId: string,
  groupeId: string,
  texte: string,
  ouvrirLe: string,
  aujourdhui: string,
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
    data: { groupeId, membreId, texte: propre.slice(0, LONGUEUR_CAPSULE), ouvrirLe },
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
    select: {
      id: true, ouvrirLe: true, creeLe: true, texte: true, membreId: true,
      membre: { select: { pseudo: true } },
    },
  });

  return lignes.map((c) => ({
    id: c.id,
    auteur: c.membre.pseudo,
    auteurId: c.membreId,
    ouvrirLe: c.ouvrirLe,
    creeLe: c.creeLe.toISOString().slice(0, 10),
    // Scellée : le texte ne quitte pas le serveur. Le cacher côté client
    // reviendrait à l'envoyer et à demander poliment de ne pas regarder.
    texte: c.ouvrirLe <= aujourdhui ? c.texte : null,
    mienne: c.membreId === membreId,
  }));
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
