import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { prisma } from "./db";
import { jourDeLaBande } from "./dates";
import { JEUX, jeuParCle } from "./jeux/catalogue";
import { classement, crediter } from "./jeux/recompense";
import { codeValide, estPresent, prochainHote, tirerCode } from "./jeux/salon";
import {
  LONGUEUR_CARTE,
  MAX_CARTES,
  type CarteMaison,
  type EtatPartie,
  type EtatSalon,
  type FinDePartie,
  type Partie,
} from "./jeux/types";
import { ErreurMetier } from "./depot";
import { cleParole } from "./stockage/cles";
import { ecrireOctets, lireOctets, stockageDistant, supprimerOctets } from "./stockage";
import { initialesDeLaBande } from "./initiales";

/**
 * Tout ce qui touche la base **pour les jeux** passe par ici.
 *
 * C'est le même contrat que `depot.ts` — rien d'autre ne parle à Prisma, et on
 * rend des types du domaine, pas des lignes Prisma. Fichier séparé parce que
 * `depot.ts` frôlait les mille lignes : la règle du plan interdit les
 * composants de huit cents lignes, et l'esprit vaut aussi pour un dépôt.
 *
 * **L'autorisation est ici, pas dans les écrans.** Toute lecture est filtrée
 * par `groupeId`, et chaque écriture vérifie d'abord que la partie appartient
 * bien à la bande de celui qui écrit. C'est ce qui remplace la RLS du plan.
 */

export type {
  ActionDeJoueur,
  CarteMaison,
  EtatPartie,
  EtatSalon,
  FinDePartie,
  Joueur,
  Partie,
} from "./jeux/types";
export { LONGUEUR_CARTE, MAX_CARTES } from "./jeux/types";

/**
 * Les clés des jeux qui se jouent par-dessus les autres.
 *
 * Calculée une fois depuis le catalogue plutôt qu'écrite à la main : un jeu de
 * fond ajouté sans toucher ici bloquerait toute la soirée, et le défaut ne se
 * verrait qu'au moment de lancer autre chose.
 */
const JEUX_DE_FOND = JEUX.filter((j) => j.fond).map((j) => j.cle);

async function bandeDe(membreId: string): Promise<string | null> {
  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  return membre?.groupeId ?? null;
}

/**
 * Ouvrir une partie.
 *
 * L'ordre de passage est tiré ici, une fois, et gardé : le tirer à chaque
 * manche donnerait trois tours d'affilée à la même personne, ce qui n'a l'air
 * d'un hasard pour personne.
 */
export async function lancerPartie(
  membreId: string,
  jeu: string,
  joueurs: { membreId: string; sobre: boolean }[],
): Promise<string> {
  if (!jeuParCle(jeu)) throw new ErreurMetier("Ce jeu n'existe pas.");
  if (joueurs.length < 2) throw new ErreurMetier("Il faut être au moins deux.");

  const moi = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!moi) throw new ErreurMetier("Session inconnue.");

  // Tous les joueurs doivent être de la bande. Sans cette vérification, un
  // identifiant glissé dans le formulaire ferait entrer un inconnu au score.
  const dansLaBande = await prisma.membre.findMany({
    where: { groupeId: moi.groupeId, id: { in: joueurs.map((j) => j.membreId) } },
    select: { id: true },
  });
  if (dansLaBande.length !== joueurs.length) {
    throw new ErreurMetier("Un joueur n'est pas de la bande.");
  }

  const melange = [...joueurs].sort(() => Math.random() - 0.5);
  const partie = await prisma.partie.create({
    data: {
      groupeId: moi.groupeId,
      jeu,
      // Les DEUX colonnes, explicitement. Le lot N a fait du multi le mode par
      // défaut du schéma, et `etat` y naît à « salon » : laisser les valeurs par
      // défaut ici créait une partie « multi » coincée dans un salon que
      // personne n'avait ouvert — le mode d'un seul téléphone ne démarrait plus
      // du tout. Un défaut de colonne est une décision sur les lignes à venir,
      // pas une dispense de dire ce qu'on veut.
      mode: "un-telephone",
      etat: "encours",
      scores: {
        create: melange.map((j, ordre) => ({
          membreId: j.membreId,
          sobre: j.sobre,
          ordre,
        })),
      },
    },
  });
  return partie.id;
}

/** La partie, avec ses joueurs — ou `null` si elle n'est pas de cette bande. */
export async function chargerPartie(membreId: string, partieId: string): Promise<Partie | null> {
  const moi = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!moi) return null;

  const partie = await prisma.partie.findFirst({
    where: { id: partieId, groupeId: moi.groupeId },
    include: { scores: { orderBy: { ordre: "asc" } } },
  });
  if (!partie) return null;

  // Les initiales se calculent sur la BANDE entière, pas sur les joueurs de la
  // partie : deux « Sam » doivent se distinguer de la même façon partout, sinon
  // la barre de score et le fil n'appellent pas les gens pareil.
  const membres = await prisma.membre.findMany({
    where: { groupeId: moi.groupeId },
    orderBy: { teinte: "asc" },
    select: { id: true, pseudo: true, teinte: true, avatar: true },
  });
  const marques = initialesDeLaBande(membres.map((m) => m.pseudo));
  const parId = new Map(membres.map((m, i) => [m.id, { ...m, initiales: marques[i] }]));

  return {
    id: partie.id,
    jeu: partie.jeu,
    mode: partie.mode,
    commenceeLe: partie.commenceeLe.toISOString(),
    finie: partie.finieLe !== null,
    joueurs: partie.scores.flatMap((score) => {
      const membre = parId.get(score.membreId);
      if (!membre) return [];
      return [{
        membreId: score.membreId,
        pseudo: membre.pseudo,
        teinte: membre.teinte,
        initiales: membre.initiales,
        avatar: membre.avatar ? `/api/avatar/${score.membreId}` : null,
        points: score.points,
        sobre: score.sobre,
        ordre: score.ordre,
      }];
    }),
  };
}

/**
 * Marquer des points.
 *
 * L'incrément passe par `increment` plutôt que par une lecture puis une
 * écriture : deux téléphones qui marquent en même temps se perdraient
 * autrement l'un l'autre, et c'est exactement ce qui arrive quand on se passe
 * l'appareil pendant que quelqu'un regarde encore l'écran précédent.
 */
export async function marquer(
  membreId: string,
  partieId: string,
  points: { membreId: string; delta: number }[],
): Promise<void> {
  const partie = await chargerPartie(membreId, partieId);
  if (!partie) throw new ErreurMetier("Partie inconnue.");
  if (partie.finie) throw new ErreurMetier("Cette partie est finie.");

  const connus = new Set(partie.joueurs.map((j) => j.membreId));
  await prisma.$transaction(
    points
      .filter((p) => connus.has(p.membreId) && p.delta !== 0)
      .map((p) =>
        prisma.scorePartie.update({
          where: { partieId_membreId: { partieId, membreId: p.membreId } },
          data: { points: { increment: p.delta } },
        }),
      ),
  );
}

/**
 * Ranger une manche, pour pouvoir la relire.
 *
 * Le numéro est attribué **ici**, pas par l'écran : le compter côté client
 * demanderait de le garder d'un rendu à l'autre, et deux manches envoyées coup
 * sur coup porteraient le même numéro. La manche 0 est réservée au décompte
 * final, d'où le `numero: { gt: 0 }`.
 */
export async function enregistrerManche(
  membreId: string,
  partieId: string,
  manche: { membreId?: string | null; donnees: Record<string, unknown> },
): Promise<void> {
  const partie = await chargerPartie(membreId, partieId);
  if (!partie) throw new ErreurMetier("Partie inconnue.");
  const jouees = await prisma.manche.count({ where: { partieId, numero: { gt: 0 } } });
  await prisma.manche.create({
    data: {
      partieId,
      numero: jouees + 1,
      membreId: manche.membreId ?? null,
      donnees: manche.donnees as never,
    },
  });
}

/**
 * Finir une partie, et convertir ses points en points d'application.
 *
 * La conversion est calculée à la fermeture et **rangée dans la manche zéro**,
 * pas recalculée à chaque lecture du profil : le plafond quotidien de jeu
 * dépend de ce qui a déjà été crédité ce jour-là, donc d'un ordre. Recalculer
 * ferait changer le passé chaque fois qu'une nouvelle partie se termine.
 */
export async function terminerPartie(membreId: string, partieId: string): Promise<FinDePartie> {
  const partie = await chargerPartie(membreId, partieId);
  if (!partie) throw new ErreurMetier("Partie inconnue.");
  if (partie.finie) return lireRecompenses(partieId);

  const jour = jourDeLaBande();
  const groupeId = await bandeDe(membreId);
  if (!groupeId) throw new ErreurMetier("Session inconnue.");
  const dejaGagne: Record<string, number> = {};
  for (const gain of await gainsDuJour(groupeId, partie.joueurs.map((j) => j.membreId), jour)) {
    dejaGagne[gain.membreId] = (dejaGagne[gain.membreId] ?? 0) + gain.points;
  }

  const recompenses = crediter(
    classement(partie.joueurs.map((j) => ({ membreId: j.membreId, points: j.points }))),
    dejaGagne,
  );

  await prisma.$transaction([
    // `etat` et `code` en même temps que `finieLe` : sans ça une partie terminée
    // garderait l'état où elle est morte. Un salon resté « salon » continuerait
    // d'afficher le bandeau « rejoindre » chez les autres, et un code resté
    // valable laisserait quelqu'un entrer dans une partie qui n'existe plus.
    prisma.partie.update({
      where: { id: partieId },
      data: { finieLe: new Date(), etat: "finie", code: null, version: { increment: 1 } },
    }),
    prisma.manche.create({
      data: { partieId, numero: 0, donnees: { recompenses, jour } as never },
    }),
  ]);
  return recompenses;
}

/**
 * Ce qu'une partie a rapporté, pour qui a le droit de le lire.
 *
 * Le podium doit survivre à un rafraîchissement : sans ça, la revalidation qui
 * suit la fin de partie remplace l'écran par la liste des jeux, et personne ne
 * voit son classement. C'est le défaut qu'une capture a montré.
 */
export async function recompensesDe(
  membreId: string,
  partieId: string,
): Promise<FinDePartie | null> {
  const partie = await chargerPartie(membreId, partieId);
  if (!partie) return null;
  return lireRecompenses(partieId);
}

/** Ce qu'une partie a rapporté, relu depuis la manche zéro. */
async function lireRecompenses(partieId: string): Promise<FinDePartie> {
  const manche = await prisma.manche.findFirst({ where: { partieId, numero: 0 } });
  const donnees = manche?.donnees as { recompenses?: FinDePartie } | null;
  return donnees?.recompenses ?? [];
}

/**
 * Les points de jeu déjà gagnés, par personne et par jour.
 *
 * Sert à deux choses : appliquer le plafond quotidien à la fermeture d'une
 * partie, et alimenter l'ardoise du profil.
 */
export async function gainsDeLaBande(
  groupeId: string,
): Promise<{ membreId: string; jour: string; points: number; place: number }[]> {
  const manches = await prisma.manche.findMany({
    where: { numero: 0, partie: { groupeId, finieLe: { not: null } } },
    select: { donnees: true },
  });
  return manches.flatMap((manche) => {
    const donnees = manche.donnees as { recompenses?: FinDePartie; jour?: string } | null;
    if (!donnees?.recompenses || !donnees.jour) return [];
    const jour = donnees.jour;
    return donnees.recompenses.map((r) => ({
      membreId: r.membreId,
      jour,
      points: r.points,
      // La place sert au badge « sur le podium » ; l'ardoise, elle, l'ignore.
      place: r.place,
    }));
  });
}

async function gainsDuJour(groupeId: string, membreIds: string[], jour: string) {
  // Filtré par bande, comme toute lecture : sans le `groupeId`, on lirait les
  // manches des autres bandes pour n'en garder que quelques-unes. Ce qu'on ne
  // lit pas ne peut pas fuir.
  const manches = await prisma.manche.findMany({
    where: { numero: 0, partie: { groupeId, finieLe: { not: null } } },
    select: { donnees: true },
  });
  const voulus = new Set(membreIds);
  return manches.flatMap((manche) => {
    const donnees = manche.donnees as { recompenses?: FinDePartie; jour?: string } | null;
    if (!donnees?.recompenses || donnees.jour !== jour) return [];
    return donnees.recompenses.filter((r) => voulus.has(r.membreId));
  });
}

/**
 * La partie en cours, s'il y en a une.
 *
 * Une seule à la fois par bande : à trois autour d'une table, deux parties
 * simultanées ne veulent rien dire, et cette contrainte évite qu'un
 * rafraîchissement de page en ouvre une deuxième par accident.
 */
export async function partieEnCours(membreId: string): Promise<Partie | null> {
  const moi = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!moi) return null;
  const partie = await prisma.partie.findFirst({
    // Un SALON ouvert n'est pas une partie en cours : celui qui l'a ouvert doit
    // pouvoir changer d'avis de jeu sans avoir à l'abandonner d'abord, et
    // `ouvrirSalon` ferme le précédent tout seul. Seule une partie vraiment
    // lancée empêche d'en commencer une autre.
    //
    // Un jeu **de fond** non plus : « Le mot de passe » dure la soirée, et s'il
    // comptait comme la partie en cours il interdirait de jouer à quoi que ce
    // soit pendant trois heures — c'est-à-dire exactement le contraire de ce
    // qu'il est.
    where: {
      groupeId: moi.groupeId,
      finieLe: null,
      etat: { not: "salon" },
      jeu: { notIn: JEUX_DE_FOND },
    },
    orderBy: { commenceeLe: "desc" },
    select: { id: true },
  });
  return partie ? chargerPartie(membreId, partie.id) : null;
}

/** Le jeu de fond ouvert, s'il y en a un. Il s'affiche à part sur la liste. */
export async function partieDeFond(membreId: string): Promise<Partie | null> {
  const moi = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!moi) return null;
  const partie = await prisma.partie.findFirst({
    where: {
      groupeId: moi.groupeId,
      finieLe: null,
      etat: { not: "salon" },
      jeu: { in: JEUX_DE_FOND },
    },
    orderBy: { commenceeLe: "desc" },
    select: { id: true },
  });
  return partie ? chargerPartie(membreId, partie.id) : null;
}

/**
 * Abandonner.
 *
 * La partie est supprimée, pas marquée finie : une partie abandonnée ne
 * rapporte rien (voir `recompense.ts`), et la garder en base n'ajouterait
 * qu'une ligne vide dans l'historique.
 */
export async function abandonnerPartie(membreId: string, partieId: string): Promise<void> {
  const partie = await chargerPartie(membreId, partieId);
  if (!partie) throw new ErreurMetier("Partie inconnue.");
  if (partie.finie) throw new ErreurMetier("Une partie finie ne s'abandonne pas.");
  await prisma.partie.delete({ where: { id: partieId } });
}

// ── Les paroles : ce qu'on a dit pendant un jeu, et qu'on garde ─────────────

/** Quatre-vingt-dix secondes, plus deux de marge pour l'arrêt du micro. */
export const DUREE_MAX_PAROLE = 92_000;
const POIDS_MAX_PAROLE = 6 * 1024 * 1024;
const MIMES_PAROLE = ["audio/mp4", "audio/aac", "audio/webm", "audio/ogg", "audio/mpeg"];

export type Parole = {
  id: string;
  membreId: string;
  manche: number;
  sujet: string;
  duree: number;
  niveaux: number[];
  note: number | null;
  creeLe: string;
};

/**
 * Garder une parole.
 *
 * Même règle que partout : les octets vont chez R2 quand il est branché, en
 * base sinon, jamais les deux. Et la ligne est créée AVANT l'écriture distante,
 * parce que la clé se construit sur l'identifiant.
 */
export async function ajouterParole(
  membreId: string,
  partieId: string,
  manche: number,
  sujet: string,
  son: { mime: string; octets: Uint8Array<ArrayBuffer>; duree: number; niveaux: number[] },
): Promise<string> {
  await maPartie(membreId, partieId);
  const type = son.mime.split(";")[0].trim();
  if (!MIMES_PAROLE.includes(type)) throw new ErreurMetier("Ce format de son n'est pas accepté.");
  if (son.octets.byteLength > POIDS_MAX_PAROLE) throw new ErreurMetier("Cet enregistrement est trop lourd.");

  const donnees = {
    partieId,
    membreId,
    manche,
    sujet: sujet.slice(0, 200),
    mime: type,
    duree: Math.min(son.duree, DUREE_MAX_PAROLE),
    poids: son.octets.byteLength,
    niveaux: son.niveaux.slice(0, 64).map((n) => Math.max(0, Math.min(100, Math.round(n)))),
  };

  // Une seule parole par joueur et par manche : réenregistrer remplace, comme
  // pour une note vocale. Sinon un micro capricieux laisse trois prises dont
  // personne ne sait laquelle est la bonne.
  const ancienne = await prisma.parole.findFirst({
    where: { partieId, membreId, manche },
    select: { id: true, cle: true },
  });
  if (ancienne) {
    await supprimerOctets(ancienne.cle);
    await prisma.parole.delete({ where: { id: ancienne.id } });
  }

  const ligne = await prisma.parole.create({ data: donnees, select: { id: true } });
  if (stockageDistant()) {
    const cle = await ecrireOctets(cleParole(ligne.id), son.octets, type);
    await prisma.parole.update({ where: { id: ligne.id }, data: { cle } });
  } else {
    await prisma.parole.update({ where: { id: ligne.id }, data: { octets: son.octets } });
  }
  await toucherVersion(partieId);
  return ligne.id;
}

/** Les octets d'une parole, pour qui a le droit de les entendre. */
export async function lireParole(
  membreId: string,
  paroleId: string,
): Promise<{ mime: string; octets: Uint8Array } | null> {
  const moi = await bandeDe(membreId);
  if (!moi) return null;

  const parole = await prisma.parole.findFirst({
    // Le filtre passe par la partie : une parole appartient à la bande qui l'a
    // dite, et à personne d'autre. Sans ce `groupeId`, un identifiant deviné
    // ouvrirait la soirée des voisins.
    where: { id: paroleId, partie: { groupeId: moi } },
    select: { mime: true, octets: true, cle: true },
  });
  if (!parole) return null;

  const octets = parole.cle
    ? await lireOctets(parole.cle)
    : parole.octets
      ? new Uint8Array(parole.octets)
      : null;
  return octets ? { mime: parole.mime, octets } : null;
}

/** Les paroles d'une partie, sans les octets. */
export async function parolesDePartie(membreId: string, partieId: string): Promise<Parole[]> {
  await maPartie(membreId, partieId);
  const lignes = await prisma.parole.findMany({
    where: { partieId },
    orderBy: { creeLe: "asc" },
    select: {
      id: true,
      membreId: true,
      manche: true,
      sujet: true,
      duree: true,
      niveaux: true,
      note: true,
      creeLe: true,
    },
  });
  return lignes.map((l) => ({ ...l, creeLe: l.creeLe.toISOString() }));
}

/**
 * Les dernières paroles de la bande, pour les souvenirs.
 *
 * C'est là qu'elles servent vraiment : une théorie du complot défendue un
 * samedi soir n'a pas d'intérêt le samedi soir, elle en a le mardi suivant,
 * quand personne ne s'y attend.
 */
export async function parolesDeLaBande(
  membreId: string,
  combien = 6,
): Promise<(Parole & { jeu: string; pseudo: string })[]> {
  const groupeId = await bandeDe(membreId);
  if (!groupeId) return [];

  const lignes = await prisma.parole.findMany({
    where: { partie: { groupeId } },
    orderBy: { creeLe: "desc" },
    take: combien,
    select: {
      id: true,
      membreId: true,
      manche: true,
      sujet: true,
      duree: true,
      niveaux: true,
      note: true,
      creeLe: true,
      partie: { select: { jeu: true } },
      membre: { select: { pseudo: true } },
    },
  });

  return lignes.map((l) => ({
    id: l.id,
    membreId: l.membreId,
    manche: l.manche,
    sujet: l.sujet,
    duree: l.duree,
    niveaux: l.niveaux,
    note: l.note,
    creeLe: l.creeLe.toISOString(),
    jeu: l.partie.jeu,
    pseudo: l.membre.pseudo,
  }));
}

/** Les dernières parties de la bande, pour la page des jeux. */
export async function historiqueParties(membreId: string, limite = 5) {
  const moi = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!moi) return [];
  const parties = await prisma.partie.findMany({
    where: { groupeId: moi.groupeId, finieLe: { not: null } },
    orderBy: { finieLe: "desc" },
    take: limite,
    include: { scores: { orderBy: { points: "desc" }, take: 1 } },
  });
  const gagnants = await prisma.membre.findMany({
    where: { id: { in: parties.flatMap((p) => p.scores.map((s) => s.membreId)) } },
    select: { id: true, pseudo: true },
  });
  const parId = new Map(gagnants.map((m) => [m.id, m.pseudo]));
  return parties.map((p) => ({
    id: p.id,
    jeu: p.jeu,
    finieLe: p.finieLe!.toISOString(),
    gagnant: p.scores[0] ? (parId.get(p.scores[0].membreId) ?? null) : null,
  }));
}

// ── Les cartes que la bande écrit ───────────────────────────────────────────

/**
 * Le paquet « Nos potes », et les affirmations maison.
 *
 * C'est le seul contenu de jeu qui vit en base : il n'appartient qu'à cette
 * bande, et il change en jouant. Tout le reste est une constante du code.
 *
 * **Le droit de retrait s'applique ici comme ailleurs** : n'importe qui de la
 * bande peut retirer une carte, sans se justifier. Le plan est explicite —
 * « si un contenu gêne celui qu'il vise, il part, point » — et une carte qui
 * fait deviner un pote est exactement le genre de contenu visé.
 */
export async function cartesDeLaBande(membreId: string, paquet = "potes"): Promise<CarteMaison[]> {
  const groupeId = await bandeDe(membreId);
  if (!groupeId) return [];
  const lignes = await prisma.carteBande.findMany({
    where: { groupeId, paquet },
    orderBy: { creeeLe: "desc" },
  });
  return lignes.map((l) => ({
    id: l.id,
    texte: l.texte,
    parQui: l.membreId,
    creeeLe: l.creeeLe.toISOString(),
  }));
}

/**
 * Ajouter une carte, et **rendre la ligne créée**.
 *
 * Rendre `void` obligeait l'écran à inventer un identifiant local pour
 * l'affichage optimiste ; retirer cette carte-là juste après envoyait au
 * serveur un identifiant qui n'existait pas, la suppression ne faisait rien, et
 * la carte revenait au rechargement. C'est le défaut qu'un test a attrapé.
 */
export async function ajouterCarte(
  membreId: string,
  paquet: string,
  texte: string,
): Promise<CarteMaison> {
  const propre = texte.trim().replace(/\s+/g, " ");
  if (propre.length < 2) throw new ErreurMetier("Il faut écrire quelque chose.");
  if (propre.length > LONGUEUR_CARTE) {
    // Une carte trop longue ne tient pas sur un écran posé sur un front.
    throw new ErreurMetier(`${LONGUEUR_CARTE} caractères au maximum.`);
  }
  const groupeId = await bandeDe(membreId);
  if (!groupeId) throw new ErreurMetier("Session inconnue.");

  const combien = await prisma.carteBande.count({ where: { groupeId, paquet } });
  if (combien >= MAX_CARTES) throw new ErreurMetier("Le paquet est plein.");

  // Deux fois la même carte n'ajoute rien au paquet et se remarque en jouant.
  const deja = await prisma.carteBande.findFirst({
    where: { groupeId, paquet, texte: { equals: propre, mode: "insensitive" } },
    select: { id: true },
  });
  if (deja) throw new ErreurMetier("Elle y est déjà.");

  const ligne = await prisma.carteBande.create({
    data: { groupeId, paquet, texte: propre, membreId },
  });
  return {
    id: ligne.id,
    texte: ligne.texte,
    parQui: ligne.membreId,
    creeeLe: ligne.creeeLe.toISOString(),
  };
}

/** Le droit de retrait : n'importe qui de la bande, sans justification. */
export async function retirerCarte(membreId: string, carteId: string): Promise<void> {
  const groupeId = await bandeDe(membreId);
  if (!groupeId) throw new ErreurMetier("Session inconnue.");
  const carte = await prisma.carteBande.findFirst({
    where: { id: carteId, groupeId },
    select: { id: true },
  });
  if (!carte) throw new ErreurMetier("Cette carte n'existe pas.");
  await prisma.carteBande.delete({ where: { id: carte.id } });
}

// ── Le multi-téléphones ─────────────────────────────────────────────────────

/**
 * Ouvrir un salon.
 *
 * L'hôte est seul dedans au départ ; les autres rejoignent par la notification,
 * par le bandeau de l'accueil, ou en dictant le code. Un seul salon ouvert à la
 * fois par bande : deux salons pour trois personnes, c'est une personne qui
 * attend dans le mauvais.
 */
export async function ouvrirSalon(membreId: string, jeu: string): Promise<string> {
  if (!jeuParCle(jeu)) throw new ErreurMetier("Ce jeu n'existe pas.");
  const moi = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!moi) throw new ErreurMetier("Session inconnue.");

  // Un salon qui traîne depuis la veille n'intéresse personne : on le ferme
  // plutôt que de refuser d'en ouvrir un nouveau.
  await prisma.partie.updateMany({
    where: { groupeId: moi.groupeId, etat: "salon" },
    data: { etat: "finie", finieLe: new Date(), code: null },
  });

  // Le code doit être libre parmi les parties VIVANTES de la bande. Réessayer
  // quelques fois suffit : neuf mille codes pour au plus une poignée de
  // parties, la collision est théorique.
  let code = tirerCode();
  for (let essai = 0; essai < 8; essai += 1) {
    const pris = await prisma.partie.findFirst({
      where: { groupeId: moi.groupeId, code, etat: { not: "finie" } },
      select: { id: true },
    });
    if (!pris) break;
    code = tirerCode();
  }

  const partie = await prisma.partie.create({
    data: {
      groupeId: moi.groupeId,
      jeu,
      mode: "multi",
      etat: "salon",
      hoteId: membreId,
      code,
      scores: { create: [{ membreId, ordre: 0 }] },
    },
    select: { id: true },
  });
  return partie.id;
}

/** Le salon ouvert de la bande, s'il y en a un. Sert au bandeau de l'accueil. */
export async function salonOuvert(membreId: string) {
  const moi = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!moi) return null;

  const partie = await prisma.partie.findFirst({
    where: { groupeId: moi.groupeId, etat: "salon" },
    orderBy: { commenceeLe: "desc" },
    select: {
      id: true,
      jeu: true,
      code: true,
      hoteId: true,
      scores: { select: { membreId: true } },
    },
  });
  if (!partie) return null;

  return {
    id: partie.id,
    jeu: partie.jeu,
    code: partie.code,
    hoteId: partie.hoteId,
    jySuis: partie.scores.some((s) => s.membreId === membreId),
    combien: partie.scores.length,
  };
}

/**
 * Rejoindre un salon, par son identifiant ou par son code.
 *
 * Rend l'identifiant de la partie. Rejoindre deux fois ne fait rien de plus :
 * on revient souvent sur cet écran, et une deuxième ligne de score doublerait
 * la personne dans la liste.
 */
export async function rejoindreSalon(
  membreId: string,
  reference: { partieId?: string; code?: string },
): Promise<string> {
  const moi = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!moi) throw new ErreurMetier("Session inconnue.");

  const code = reference.code?.trim();
  if (code && !codeValide(code)) throw new ErreurMetier("Un code, c'est quatre chiffres.");

  const partie = await prisma.partie.findFirst({
    where: {
      groupeId: moi.groupeId,
      ...(reference.partieId ? { id: reference.partieId } : {}),
      ...(code ? { code } : {}),
      etat: { not: "finie" },
    },
    select: { id: true, etat: true, scores: { select: { membreId: true, ordre: true } } },
  });
  if (!partie) throw new ErreurMetier("Aucune partie ne répond à ça. Le code est peut-être expiré.");
  if (partie.scores.some((s) => s.membreId === membreId)) return partie.id;
  if (partie.etat !== "salon") {
    throw new ErreurMetier("Cette partie a déjà commencé sans toi.");
  }

  const ordre = Math.max(-1, ...partie.scores.map((s) => s.ordre)) + 1;
  await prisma.scorePartie.create({ data: { partieId: partie.id, membreId, ordre } });
  await toucherVersion(partie.id);
  return partie.id;
}

/** Sortir d'un salon. L'hôte qui s'en va passe la main plutôt que de tout fermer. */
export async function quitterSalon(membreId: string, partieId: string): Promise<void> {
  const partie = await maPartie(membreId, partieId);
  await prisma.scorePartie.deleteMany({ where: { partieId, membreId } });

  if (partie.hoteId === membreId) {
    const restants = await prisma.scorePartie.findMany({
      where: { partieId },
      select: { membreId: true, ordre: true, vuLe: true },
      orderBy: { ordre: "asc" },
    });
    const suivant = prochainHote(
      restants.map((r) => ({ membreId: r.membreId, ordre: r.ordre, present: estPresent(r.vuLe) })),
      membreId,
    );
    await prisma.partie.update({
      where: { id: partieId },
      data: suivant
        ? { hoteId: suivant, version: { increment: 1 } }
        : // Plus personne : la partie se ferme au lieu de rester ouverte sans
          // hôte, ce qui bloquerait l'ouverture de la suivante.
          { hoteId: null, etat: "finie", finieLe: new Date(), code: null, version: { increment: 1 } },
    });
    return;
  }
  await toucherVersion(partieId);
}

/**
 * Lancer la partie. L'hôte seul, et seulement à deux au minimum.
 *
 * L'ordre de passage est tiré ici : jusque-là, il suivait l'ordre d'arrivée
 * dans le salon, ce qui ferait toujours commencer celui qui a ouvert.
 */
export async function demarrerPartie(membreId: string, partieId: string): Promise<void> {
  const partie = await maPartie(membreId, partieId);
  if (partie.hoteId !== membreId) throw new ErreurMetier("C'est à l'hôte de lancer.");
  if (partie.etat !== "salon") throw new ErreurMetier("Cette partie est déjà lancée.");

  const joueurs = await prisma.scorePartie.findMany({
    where: { partieId },
    select: { id: true },
  });
  if (joueurs.length < 2) throw new ErreurMetier("Il faut être au moins deux.");

  const melange = [...joueurs].sort(() => Math.random() - 0.5);
  await prisma.$transaction([
    ...melange.map((j, ordre) =>
      prisma.scorePartie.update({ where: { id: j.id }, data: { ordre } }),
    ),
    prisma.partie.update({
      where: { id: partieId },
      data: { etat: "encours", code: null, version: { increment: 1 } },
    }),
  ]);
}

/**
 * Le battement de présence.
 *
 * Écrit sans incrémenter la version : un signe de vie toutes les cinq secondes
 * par joueur réveillerait tous les écrans en permanence pour ne rien dire. Les
 * absences se constatent à la lecture, en comparant les dates.
 */
export async function battreLeCoeur(membreId: string, partieId: string): Promise<void> {
  await prisma.scorePartie.updateMany({
    where: { partieId, membreId },
    data: { vuLe: new Date() },
  });
}

/**
 * Publier une phase : c'est le seul geste qui fait avancer une partie.
 *
 * Réservé à l'hôte. Le reste du monde envoie des ACTIONS, et c'est l'hôte qui
 * décide quand la manche passe à la suite. Un serveur qui arbitrerait tout seul
 * demanderait d'y écrire les règles des dix jeux ; là, les règles restent dans
 * le jeu, et le serveur ne garantit qu'une chose — que tout le monde lise la
 * même phase au même moment.
 */
export async function publierPhase(
  membreId: string,
  partieId: string,
  phase: {
    nom: string;
    manche?: number;
    donnees?: Record<string, unknown>;
    /** En millisecondes à partir de maintenant. */
    delai?: number | null;
  },
): Promise<void> {
  const partie = await maPartie(membreId, partieId);
  if (partie.hoteId !== membreId) throw new ErreurMetier("C'est à l'hôte de mener la manche.");
  if (partie.etat === "finie") throw new ErreurMetier("Cette partie est finie.");

  const manche = phase.manche ?? partie.mancheCourante;
  await prisma.partie.update({
    where: { id: partieId },
    data: {
      phase: phase.nom,
      donneesPhase: { ...(phase.donnees ?? {}), manche } as Prisma.InputJsonValue,
      echeance: phase.delai ? new Date(Date.now() + phase.delai) : null,
      version: { increment: 1 },
    },
  });
}

/**
 * Ce qu'un joueur répond.
 *
 * `upsert` sur (partie, manche, phase, joueur) : renvoyer deux fois la même
 * réponse parce que le réseau a hésité ne doit pas créer deux votes. Et
 * l'horodatage vient du serveur — c'est lui qui départage un duel de réflexe,
 * pas l'horloge du téléphone le plus optimiste.
 */
export async function agir(
  membreId: string,
  partieId: string,
  manche: number,
  phase: string,
  donnees: Record<string, unknown>,
): Promise<void> {
  await maPartie(membreId, partieId);
  const valeur = donnees as Prisma.InputJsonValue;
  await prisma.actionJoueur.upsert({
    where: { partieId_manche_phase_membreId: { partieId, manche, phase, membreId } },
    create: { partieId, membreId, manche, phase, donnees: valeur },
    update: { donnees: valeur, creeeLe: new Date() },
  });
  await toucherVersion(partieId);
}

/**
 * Reprendre la main quand l'hôte a disparu.
 *
 * Le transfert automatique de `quitterSalon` couvre le départ volontaire. Il
 * reste le cas le plus fréquent : un téléphone qui s'éteint, une batterie à
 * plat, quelqu'un qui répond au téléphone et verrouille sans réfléchir. La
 * partie n'a alors plus personne pour la faire avancer.
 *
 * N'importe quel joueur PRÉSENT peut alors prendre la main — mais seulement si
 * l'hôte est vraiment absent, c'est-à-dire sans signe de vie depuis vingt
 * secondes. Sans cette condition, il suffirait d'appeler la fonction pour
 * voler le salon à quelqu'un qui joue.
 */
export async function reprendreLaMain(membreId: string, partieId: string): Promise<boolean> {
  const partie = await maPartie(membreId, partieId);
  if (partie.hoteId === membreId) return true;

  const scores = await prisma.scorePartie.findMany({
    where: { partieId },
    select: { membreId: true, vuLe: true },
  });
  if (!scores.some((s) => s.membreId === membreId)) {
    throw new ErreurMetier("Tu n'es pas dans cette partie.");
  }

  const hote = scores.find((s) => s.membreId === partie.hoteId);
  // Un hôte encore là garde la main : la reprise n'est pas un bouton de
  // confort, c'est un dépannage.
  if (hote && estPresent(hote.vuLe)) return false;

  await prisma.partie.update({
    where: { id: partieId },
    data: { hoteId: membreId, version: { increment: 1 } },
  });
  return true;
}

/**
 * Qui est présent, et rien d'autre.
 *
 * Le flux ne recharge l'état complet que lorsque la version bouge, et un
 * battement de cœur ne la fait pas bouger — sinon trois téléphones
 * rechargeraient la partie toutes les cinq secondes pour apprendre qu'il ne
 * s'est rien passé. Mais une ABSENCE ne change aucune version : personne ne
 * publie « je suis parti », on le déduit d'un silence. D'où cette lecture
 * minuscule, que le flux compare d'un battement à l'autre.
 *
 * Sans elle, un téléphone qui s'éteint reste « présent » jusqu'à la prochaine
 * reconnexion du flux — cinquante secondes — et pendant ce temps la manche
 * attend une réponse qui ne viendra pas, et personne ne peut reprendre la main.
 */
export async function presenceDePartie(partieId: string): Promise<string[]> {
  const scores = await prisma.scorePartie.findMany({
    where: { partieId },
    select: { membreId: true, vuLe: true },
  });
  return scores
    .filter((s) => estPresent(s.vuLe))
    .map((s) => s.membreId)
    .sort();
}

/** La version seule : c'est tout ce que le flux relit entre deux battements. */
export async function versionPartie(partieId: string): Promise<number | null> {
  const partie = await prisma.partie.findUnique({
    where: { id: partieId },
    select: { version: true },
  });
  return partie?.version ?? null;
}

/** L'état complet, tel que le serveur le voit. La seule vérité. */
export async function lireEtatPartie(
  membreId: string,
  partieId: string,
): Promise<EtatPartie | null> {
  const base = await chargerPartie(membreId, partieId);
  if (!base) return null;

  const ligne = await prisma.partie.findUnique({
    where: { id: partieId },
    select: {
      etat: true,
      hoteId: true,
      code: true,
      phase: true,
      donneesPhase: true,
      echeance: true,
      version: true,
      scores: { select: { membreId: true, vuLe: true, ordre: true } },
      manches: { orderBy: { numero: "desc" }, take: 1, select: { numero: true } },
    },
  });
  if (!ligne) return null;

  const maintenant = new Date();
  const donneesPhase = (ligne.donneesPhase ?? {}) as Record<string, unknown>;
  const manche = Number(donneesPhase.manche ?? ligne.manches[0]?.numero ?? 0);

  // Seules les actions de la manche en cours descendent : les précédentes ne
  // servent qu'à l'historique, et les envoyer ferait grossir chaque battement.
  const actions = await prisma.actionJoueur.findMany({
    where: { partieId, manche },
    orderBy: { creeeLe: "asc" },
    select: { membreId: true, manche: true, phase: true, donnees: true, creeeLe: true },
  });

  return {
    partie: base,
    etat: ligne.etat as EtatSalon,
    hoteId: ligne.hoteId,
    code: ligne.code,
    manche,
    phase: ligne.phase,
    donneesPhase,
    echeance: ligne.echeance?.toISOString() ?? null,
    version: ligne.version,
    presents: ligne.scores
      .filter((s) => estPresent(s.vuLe, maintenant))
      .map((s) => s.membreId),
    actions: actions.map((a) => ({
      membreId: a.membreId,
      manche: a.manche,
      phase: a.phase,
      donnees: (a.donnees ?? {}) as Record<string, unknown>,
      quand: a.creeeLe.toISOString(),
    })),
    maintenant: maintenant.toISOString(),
  };
}

/**
 * La partie, si elle est bien de ma bande. Le contrôle d'appartenance, une fois.
 *
 * `mancheCourante` est calculé ici plutôt que stocké : il se déduit des données
 * de phase, et une colonne de plus serait une colonne de plus à tenir d'accord
 * avec elles.
 */
async function maPartie(membreId: string, partieId: string) {
  const moi = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { groupeId: true },
  });
  if (!moi) throw new ErreurMetier("Session inconnue.");
  const partie = await prisma.partie.findFirst({
    where: { id: partieId, groupeId: moi.groupeId },
    select: { id: true, hoteId: true, etat: true, donneesPhase: true },
  });
  if (!partie) throw new ErreurMetier("Cette partie n'existe pas.");
  const donnees = (partie.donneesPhase ?? {}) as Record<string, unknown>;
  return { ...partie, mancheCourante: Number(donnees.manche ?? 0) };
}

/** Réveiller les écrans sans rien changer d'autre. */
async function toucherVersion(partieId: string): Promise<void> {
  await prisma.partie.update({
    where: { id: partieId },
    data: { version: { increment: 1 } },
  });
}

// ── Le réveil du matin ───────────────────────────────────────────────────────

/**
 * Les plaidoyers du « Tribunal des idées » à renvoyer à leur auteur.
 *
 * **C'est le principe du jeu**, et il est resté en dette depuis le lot O : on
 * défend une idée absurde avec conviction, et le lendemain matin on se réécoute.
 * La parole est gardée depuis le début ; il ne manquait que le réveil.
 *
 * Le lendemain et pas le soir même : à trois heures du matin, tout le monde
 * trouve encore que c'était brillant.
 */
export async function parolesARenvoyer(avant: Date) {
  const lignes = await prisma.parole.findMany({
    where: {
      renvoyeeLe: null,
      creeLe: { lt: avant },
      partie: { jeu: "tribunal" },
    },
    select: {
      id: true,
      membreId: true,
      sujet: true,
      partie: { select: { groupeId: true } },
    },
    take: 50,
  });
  return lignes.map((p) => ({
    id: p.id,
    membreId: p.membreId,
    sujet: p.sujet,
    groupeId: p.partie.groupeId,
  }));
}

/** La parole est repartie chez son auteur. On ne la renverra pas demain. */
export async function marquerParoleRenvoyee(paroleId: string) {
  await prisma.parole.update({ where: { id: paroleId }, data: { renvoyeeLe: new Date() } });
}
