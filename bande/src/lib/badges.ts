/**
 * Les badges, calculés à partir des journées posées.
 *
 * Aucun n'est stocké. Un badge en base, c'est une table à tenir à jour, un
 * compteur qui dérive, et un badge affiché comme obtenu alors qu'il ne l'est
 * pas — ce qui vaut moins que rien. Ici, chacun se déduit des données à chaque
 * affichage : il ne peut pas mentir.
 *
 * Deux règles les traversent toutes :
 *
 * · aucun badge ne récompense d'être heureux. On décore l'assiduité, la
 *   constance, le fait de raconter — jamais la note. Un badge « dix jours à
 *   plus de 8 » demanderait d'aller bien pour être décoré, et transformerait
 *   un journal en concours ;
 * · un mauvais jour compte autant qu'un bon. « Même les jours creux » se gagne
 *   en posant une journée à 1, et c'est un des plus honorables.
 */
import { decaler, jourSemaine } from "./dates";
import type { Badge, Entree } from "./types";

// ── Séries ───────────────────────────────────────────────────────────────────

/** La plus longue série de jours consécutifs dans un ensemble de dates. */
export function plusLongueSerie(jours: Set<string>): number {
  let record = 0;
  for (const jour of jours) {
    // On ne compte une série que depuis son premier jour : sinon chaque jour
    // d'une série de trente relancerait le parcours complet.
    if (jours.has(decaler(jour, -1))) continue;
    let longueur = 0;
    let curseur = jour;
    while (jours.has(curseur)) {
      longueur += 1;
      curseur = decaler(curseur, 1);
    }
    record = Math.max(record, longueur);
  }
  return record;
}

/** La série en cours, en remontant depuis aujourd'hui (ou hier si rien ce soir). */
export function serieEnCours(jours: Set<string>, aujourdhui: string): number {
  // La soirée n'est pas finie : ne pas avoir encore posé ne casse pas la série.
  let curseur = jours.has(aujourdhui) ? aujourdhui : decaler(aujourdhui, -1);
  let compte = 0;
  while (jours.has(curseur)) {
    compte += 1;
    curseur = decaler(curseur, -1);
  }
  return compte;
}

// ── Classement d'assiduité ───────────────────────────────────────────────────

export type RangAssiduite = {
  profil: string;
  joursPostes: number;
  /** Rang partagé en cas d'égalité : deux premiers, puis un troisième. */
  rang: number;
};

/** Le lundi de la semaine où tombe une date. */
export function lundiDeLaSemaine(jour: string): string {
  const j = jourSemaine(jour);
  return decaler(jour, j === 0 ? -6 : 1 - j);
}

/**
 * Le classement de la semaine, sur l'assiduité et rien d'autre.
 *
 * C'est un choix, et le plus important de cet écran : classer sur la joie
 * reviendrait à demander à quelqu'un qui traverse un mauvais mois de perdre
 * toutes les semaines. On compte les journées posées — ce que chacun contrôle
 * vraiment.
 */
export function classementAssiduite(
  entrees: Entree[],
  profils: string[],
  aujourdhui: string,
): RangAssiduite[] {
  const lundi = lundiDeLaSemaine(aujourdhui);
  const semaine = new Set(Array.from({ length: 7 }, (_, i) => decaler(lundi, i)));

  const compte = new Map(profils.map((p) => [p, 0]));
  for (const entree of entrees) {
    if (semaine.has(entree.jour) && compte.has(entree.profil)) {
      compte.set(entree.profil, compte.get(entree.profil)! + 1);
    }
  }

  const ordonne = [...compte.entries()]
    .map(([profil, joursPostes]) => ({ profil, joursPostes }))
    .sort((a, b) => b.joursPostes - a.joursPostes);

  // Rangs partagés : deux personnes à égalité sont toutes deux premières, et la
  // suivante est troisième. Un départage arbitraire ferait perdre quelqu'un sur
  // rien.
  let rang = 0;
  let precedent: number | null = null;
  return ordonne.map((ligne, index) => {
    if (precedent === null || ligne.joursPostes !== precedent) {
      rang = index + 1;
      precedent = ligne.joursPostes;
    }
    return { ...ligne, rang };
  });
}

// ── Badges ───────────────────────────────────────────────────────────────────

type Definition = {
  cle: string;
  nom: string;
  description: string;
  emoji: string;
  /** Un badge secret ne dit ni son nom ni sa règle tant qu'il n'est pas gagné. */
  secret?: boolean;
  /** La date d'obtention, ou null. */
  quand: (m: Mesures) => string | null;
};

type Mesures = {
  chronologie: Entree[];
  jours: Set<string>;
  reactionsLaissees: { jour: string }[];
  commentairesLaisses: { jour: string }[];
  /** Les points, pour le badge des mille. */
  points: number;
  /** Le jour de la dernière journée posée : la date à laquelle dater un seuil. */
  dernierJour: string | null;
  premierScelleOuvert: string | null;
  premierPodium: string | null;
};

/** Le n-ième élément d'une liste chronologique, ou null. */
const nieme = <T extends { jour: string }>(liste: T[], n: number) =>
  liste.length >= n ? liste[n - 1].jour : null;

const premierOu = (liste: Entree[], test: (e: Entree) => boolean) =>
  liste.find(test)?.jour ?? null;

/**
 * Huit badges, et pas un de plus.
 *
 * Il y en avait vingt-trois. Un mur de vingt-trois cases dont on en a douze
 * grises ne récompense rien : il rappelle surtout tout ce qu'on n'a pas fait.
 * Huit qui veulent dire quelque chose valent mieux.
 *
 * Rien n'est stocké, donc retirer une définition ne casse l'écran de personne :
 * les badges se recalculent à chaque affichage.
 */
const DEFINITIONS: Definition[] = [
  { cle: "premiere", nom: "Première journée", description: "Le début de tout", emoji: "🌱",
    quand: (m) => nieme(m.chronologie, 1) },
  { cle: "trentaine", nom: "Trente jours", description: "Trente journées posées", emoji: "🏔️",
    quand: (m) => nieme(m.chronologie, 30) },
  { cle: "cent", nom: "Cent journées", description: "Cent journées posées", emoji: "💯",
    quand: (m) => nieme(m.chronologie, 100) },
  { cle: "plein-pot", nom: "Plein pot", description: "Une journée notée 10", emoji: "🌟",
    quand: (m) => premierOu(m.chronologie, (e) => e.joie === 10) },
  { cle: "capsule", nom: "Le jour dit", description: "Un scellé s'est ouvert", emoji: "⏳",
    quand: (m) => m.premierScelleOuvert },
  { cle: "podium", nom: "Sur le podium", description: "Une fin de partie dans les trois premiers", emoji: "🏆",
    quand: (m) => m.premierPodium },
  { cle: "mille", nom: "Mille points", description: "Mille points, à force d'être là", emoji: "🧮",
    quand: (m) => (m.points >= 1000 ? m.dernierJour : null) },

  // Le secret : sa description ne s'affiche qu'une fois gagné. Poser un 1 et
  // un 10 dans la même semaine, c'est une semaine qu'on n'oublie pas — et
  // c'est le contraire d'un badge qui récompense d'aller bien.
  { cle: "grand-ecart", nom: "Le grand écart", description: "Un 1 et un 10 dans la même semaine", emoji: "🎭",
    secret: true, quand: (m) => grandEcart(m.chronologie) },
];

/** Le premier jour où une semaine glissante contient un 1 et un 10. */
function grandEcart(chronologie: Entree[]): string | null {
  for (let i = 0; i < chronologie.length; i += 1) {
    const debut = decaler(chronologie[i].jour, -6);
    const fenetre = chronologie.slice(0, i + 1).filter((e) => e.jour >= debut);
    if (fenetre.some((e) => e.joie === 1) && fenetre.some((e) => e.joie === 10)) {
      return chronologie[i].jour;
    }
  }
  return null;
}

export const NOMBRE_BADGES = DEFINITIONS.length;

/**
 * @param miennes  mes journées
 * @param toutes   celles de la bande, pour compter ce que j'ai laissé chez les autres
 * @param moi      mon identifiant
 */
export function badgesDe(
  miennes: Entree[],
  toutes: Entree[] = miennes,
  moi = "",
  /**
   * Ce qui ne se déduit pas des seules journées. Facultatif : sans ça, les
   * trois badges concernés restent simplement à gagner, et rien ne casse.
   */
  extra: { points?: number; scelleOuvertLe?: string | null; podiumLe?: string | null } = {},
): Badge[] {
  // Les entrées arrivent du plus récent au plus ancien ; pour dater un premier
  // fait, il faut l'ordre chronologique.
  const chronologie = [...miennes].sort((a, b) => a.jour.localeCompare(b.jour));
  const parJour = [...toutes].sort((a, b) => a.jour.localeCompare(b.jour));

  const mesures: Mesures = {
    chronologie,
    jours: new Set(chronologie.map((e) => e.jour)),
    reactionsLaissees: parJour.flatMap((e) =>
      e.reactions.filter((r) => r.parQui.includes(moi)).map(() => ({ jour: e.jour })),
    ),
    commentairesLaisses: parJour.flatMap((e) =>
      e.commentaires.filter((c) => c.auteurId === moi).map(() => ({ jour: e.jour })),
    ),
    points: extra.points ?? 0,
    dernierJour: chronologie.at(-1)?.jour ?? null,
    premierScelleOuvert: extra.scelleOuvertLe ?? null,
    premierPodium: extra.podiumLe ?? null,
  };

  return DEFINITIONS.map((d) => {
    const obtenuLe = d.quand(mesures);
    return {
      cle: d.cle,
      nom: obtenuLe || !d.secret ? d.nom : "Badge secret",
      // Un secret non gagné ne dit pas ce qu'il faut faire : sinon ce n'est
      // plus un secret, c'est une consigne.
      description: obtenuLe || !d.secret ? d.description : "Il se découvre en le gagnant",
      emoji: obtenuLe || !d.secret ? d.emoji : "❔",
      obtenuLe,
    };
  });
}
