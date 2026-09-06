import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { TAILLE_MAX_BANDE, TEINTES } from "./couleurs";
import { codeInvitation, creerCodeReprise, decouperCodeReprise, normaliserCode, verifierCodeReprise } from "./codes";
import { decaler } from "./dates";
import { LONGUEUR_PSEUDO, initialesDeLaBande } from "./initiales";
import type { Declencheur, Entree, Profil } from "./types";
import { MAX_ETIQUETTES, cleEtiquette, nettoyerEtiquette } from "./etiquettes";
import { DUREE_MAX_VIDEO, LONGUEUR_LEGENDE, MAX_MEDIAS, POIDS_MAX_MEDIA } from "./media";
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
  { nom: "Marie Jane", emoji: "🌿" },
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

const MIMES_PHOTO = ["image/jpeg", "image/webp", "image/png"];
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
  /** Toujours du JPEG : c'est le navigateur qui la fabrique. */
  vignette?: Uint8Array<ArrayBuffer> | null;
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

  await prisma.media.create({
    data: {
      entreeId: entree.id,
      ordre: deja,
      genre: media.genre,
      mime: type,
      octets: media.octets,
      largeur: media.largeur,
      hauteur: media.hauteur,
      duree: media.genre === "video" ? Math.min(media.duree ?? 0, DUREE_MAX_VIDEO) : null,
      vignette: media.vignette ?? null,
      legende: nettoyerLegende(media.legende),
    },
  });
  return entree.groupeId;
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
  await prisma.media.delete({ where: { id: mediaId } });
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
      vignette: vignette ? true : undefined,
      entree: { select: { groupeId: true } },
    },
  });
  if (!media) return null;

  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  // Le média d'une autre bande ne se sert pas, même avec le bon identifiant.
  if (!membre || membre.groupeId !== media.entree.groupeId) return null;

  if (vignette) {
    // Une vignette manquante n'est pas une erreur : les photos posées avant
    // l'arrivée des vignettes n'en ont pas. La route servira l'original.
    return media.vignette ? { mime: "image/jpeg", octets: media.vignette } : null;
  }
  return media.octets ? { mime: media.mime, octets: media.octets } : null;
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
      entree: { select: { jour: true, membreId: true } },
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
export async function espaceOccupe(groupeId: string) {
  const [medias] = await prisma.$queryRaw<{ octets: bigint | null; nombre: bigint }[]>`
    SELECT SUM(pg_column_size(p.octets) + COALESCE(pg_column_size(p.vignette), 0))::bigint AS octets,
           COUNT(*)::bigint AS nombre
    FROM bande_photos p
    JOIN bande_entrees e ON e.id = p.entree_id
    WHERE e.groupe_id = ${groupeId}
  `;
  const [audios] = await prisma.$queryRaw<{ octets: bigint | null; nombre: bigint }[]>`
    SELECT SUM(pg_column_size(a.octets))::bigint AS octets, COUNT(*)::bigint AS nombre
    FROM bande_audios a
    JOIN bande_entrees e ON e.id = a.entree_id
    WHERE e.groupe_id = ${groupeId}
  `;
  return {
    medias: { octets: Number(medias?.octets ?? 0), nombre: Number(medias?.nombre ?? 0) },
    audios: { octets: Number(audios?.octets ?? 0), nombre: Number(audios?.nombre ?? 0) },
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
