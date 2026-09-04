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

/** Le jour où une série atteint la longueur voulue, la première fois. */
function jourDeSerie(jours: Set<string>, longueur: number): string | null {
  for (const depart of [...jours].sort()) {
    if (jours.has(decaler(depart, -1))) continue;
    let curseur = depart;
    for (let n = 1; jours.has(curseur); n += 1) {
      if (n === longueur) return curseur;
      curseur = decaler(curseur, 1);
    }
  }
  return null;
}

/** Un mois civil entier sans en rater un seul. */
function moisComplet(jours: Set<string>): string | null {
  const parMois = new Map<string, Set<string>>();
  for (const jour of jours) {
    const mois = jour.slice(0, 7);
    if (!parMois.has(mois)) parMois.set(mois, new Set());
    parMois.get(mois)!.add(jour);
  }
  for (const mois of [...parMois.keys()].sort()) {
    const [a, m] = mois.split("-").map(Number);
    const nbJours = new Date(a, m, 0).getDate();
    if (parMois.get(mois)!.size === nbJours) return `${mois}-${String(nbJours).padStart(2, "0")}`;
  }
  return null;
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
  /** La date d'obtention, ou null. */
  quand: (m: Mesures) => string | null;
};

type Mesures = {
  chronologie: Entree[];
  jours: Set<string>;
  reactionsLaissees: { jour: string }[];
  commentairesLaisses: { jour: string }[];
};

/** Le n-ième élément d'une liste chronologique, ou null. */
const nieme = <T extends { jour: string }>(liste: T[], n: number) =>
  liste.length >= n ? liste[n - 1].jour : null;

const premierOu = (liste: Entree[], test: (e: Entree) => boolean) =>
  liste.find(test)?.jour ?? null;

const DEFINITIONS: Definition[] = [
  { cle: "premiere", nom: "Première journée", description: "Le début de tout", emoji: "🌱",
    quand: (m) => nieme(m.chronologie, 1) },
  { cle: "dix", nom: "Dix journées", description: "Dix journées posées", emoji: "🔟",
    quand: (m) => nieme(m.chronologie, 10) },
  { cle: "cinquante", nom: "Cinquante", description: "Cinquante journées posées", emoji: "🧱",
    quand: (m) => nieme(m.chronologie, 50) },
  { cle: "cent", nom: "Cent journées", description: "Cent journées posées", emoji: "💯",
    quand: (m) => nieme(m.chronologie, 100) },

  { cle: "semaine", nom: "Sept d'affilée", description: "Une semaine sans en rater un", emoji: "📅",
    quand: (m) => jourDeSerie(m.jours, 7) },
  { cle: "quinzaine", nom: "Quinze d'affilée", description: "Deux semaines de suite", emoji: "🗓️",
    quand: (m) => jourDeSerie(m.jours, 15) },
  { cle: "trentaine", nom: "Trente d'affilée", description: "Un mois de suite", emoji: "🏔️",
    quand: (m) => jourDeSerie(m.jours, 30) },
  { cle: "centaine", nom: "Cent d'affilée", description: "Cent jours sans en rater un", emoji: "🗿",
    quand: (m) => jourDeSerie(m.jours, 100) },
  { cle: "mois-plein", nom: "Mois plein", description: "Un mois civil entier, sans trou", emoji: "💎",
    quand: (m) => moisComplet(m.jours) },

  { cle: "plein-pot", nom: "Plein pot", description: "Une journée notée 10", emoji: "🌟",
    quand: (m) => premierOu(m.chronologie, (e) => e.joie === 10) },
  // Poser un 1 demande plus de cran que poser un 10. Le badge le dit.
  { cle: "jours-creux", nom: "Même les jours creux", description: "Posé une journée à 1", emoji: "🕯️",
    quand: (m) => premierOu(m.chronologie, (e) => e.joie === 1) },
  { cle: "eventail", nom: "Toute la gamme", description: "Posé au moins une fois chaque note de 1 à 10", emoji: "🎚️",
    quand: (m) => {
      const vues = new Set<number>();
      for (const e of m.chronologie) {
        vues.add(e.joie);
        if (vues.size === 10) return e.jour;
      }
      return null;
    } },
  { cle: "remontada", nom: "Remontada", description: "+4 d'une journée posée à la suivante", emoji: "📈",
    quand: (m) => ecart(m.chronologie, (d) => d >= 4) },
  { cle: "contrecoup", nom: "Le contrecoup", description: "−4 d'une journée posée à la suivante", emoji: "📉",
    quand: (m) => ecart(m.chronologie, (d) => d <= -4) },

  { cle: "raconteur", nom: "Raconteur", description: "Une journée commentée", emoji: "✍️",
    quand: (m) => premierOu(m.chronologie, (e) => Boolean(e.note)) },
  { cle: "bavard", nom: "Bavard", description: "Cinquante journées racontées", emoji: "📖",
    quand: (m) => nieme(m.chronologie.filter((e) => e.note), 50) },
  { cle: "photographe", nom: "Photographe", description: "Une image dans le fil", emoji: "📷",
    quand: (m) => premierOu(m.chronologie, (e) => Boolean(e.photo)) },
  { cle: "album", nom: "Album", description: "Dix images dans le fil", emoji: "🖼️",
    quand: (m) => nieme(m.chronologie.filter((e) => e.photo), 10) },

  { cle: "noctambule", nom: "Noctambule", description: "Un check-in entre minuit et 4 h", emoji: "🦉",
    quand: (m) => premierOu(m.chronologie, (e) => {
      const heure = Number(e.posteA.slice(0, 2));
      return heure >= 0 && heure < 4;
    }) },

  { cle: "supporter", nom: "Supporter", description: "Cinquante réactions laissées", emoji: "🙌",
    quand: (m) => nieme(m.reactionsLaissees, 50) },
  { cle: "compagnon", nom: "Compagnon", description: "Vingt-cinq commentaires laissés", emoji: "🫂",
    quand: (m) => nieme(m.commentairesLaisses, 25) },
];

function ecart(chronologie: Entree[], test: (delta: number) => boolean): string | null {
  for (let i = 1; i < chronologie.length; i += 1) {
    if (test(chronologie[i].joie - chronologie[i - 1].joie)) return chronologie[i].jour;
  }
  return null;
}

export const NOMBRE_BADGES = DEFINITIONS.length;

/**
 * @param miennes  mes journées
 * @param toutes   celles de la bande, pour compter ce que j'ai laissé chez les autres
 * @param moi      mon identifiant
 */
export function badgesDe(miennes: Entree[], toutes: Entree[] = miennes, moi = ""): Badge[] {
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
  };

  return DEFINITIONS.map((d) => ({
    cle: d.cle, nom: d.nom, description: d.description, emoji: d.emoji,
    obtenuLe: d.quand(mesures),
  }));
}
