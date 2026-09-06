import "server-only";

import { prisma } from "./db";
import { jourDeLaBande } from "./dates";
import { jeuParCle } from "./jeux/catalogue";
import { classement, crediter } from "./jeux/recompense";
import { ErreurMetier } from "./depot";
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

export type Joueur = {
  membreId: string;
  pseudo: string;
  teinte: number;
  initiales: string;
  avatar: string | null;
  points: number;
  sobre: boolean;
  ordre: number;
};

export type Partie = {
  id: string;
  jeu: string;
  mode: string;
  commenceeLe: string;
  finie: boolean;
  joueurs: Joueur[];
};

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

export type FinDePartie = { membreId: string; place: number; points: number }[];

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
    prisma.partie.update({ where: { id: partieId }, data: { finieLe: new Date() } }),
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
    where: { groupeId: moi.groupeId, finieLe: null },
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
