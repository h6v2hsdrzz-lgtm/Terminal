/**
 * Ce que la bande garde : les journées qui reviennent, les moments qui
 * ressortent, et le résumé d'un mois.
 *
 * Tout se calcule à partir des entrées — fonctions pures, testées.
 */
import { decaler, jourSemaine } from "./dates";
import { moyenne } from "./analyse";
import type { Entree } from "./types";

// ── Ce jour-là ───────────────────────────────────────────────────────────────

export type Anniversaire = { ecart: string; jour: string; entrees: Entree[] };

/**
 * Les mêmes jour et mois, les années précédentes — et le mois dernier.
 *
 * Le « il y a un mois » est là parce qu'une bande de trois mois n'a pas encore
 * d'anniversaire, et qu'un écran « ce jour-là » vide le premier jour n'aurait
 * jamais l'occasion de se remplir.
 */
export function ceJourLa(entrees: Entree[], aujourdhui: string): Anniversaire[] {
  const [annee, mois, jour] = aujourdhui.split("-").map(Number);
  const parJour = new Map<string, Entree[]>();
  for (const entree of entrees) {
    if (!parJour.has(entree.jour)) parJour.set(entree.jour, []);
    parJour.get(entree.jour)!.push(entree);
  }

  const candidats: { ecart: string; jour: string }[] = [];

  // Le mois dernier, en calant sur le dernier jour du mois quand il est plus
  // court : le 31 mars renvoie au 28 ou 29 février, pas au 3 mars.
  const moisAvant = mois === 1 ? 12 : mois - 1;
  const anneeMoisAvant = mois === 1 ? annee - 1 : annee;
  const dernierJour = new Date(anneeMoisAvant, moisAvant, 0).getDate();
  candidats.push({
    ecart: "il y a un mois",
    jour: `${anneeMoisAvant}-${String(moisAvant).padStart(2, "0")}-${String(Math.min(jour, dernierJour)).padStart(2, "0")}`,
  });

  for (let recul = 1; recul <= 5; recul += 1) {
    candidats.push({
      ecart: recul === 1 ? "il y a un an" : `il y a ${recul} ans`,
      jour: `${annee - recul}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`,
    });
  }

  return candidats
    .map(({ ecart, jour: j }) => ({ ecart, jour: j, entrees: parJour.get(j) ?? [] }))
    .filter((a) => a.entrees.length > 0);
}

// ── Le mur des moments ───────────────────────────────────────────────────────

export type Moment = { entree: Entree; raison: string };

/**
 * Les journées qui méritent qu'on y revienne.
 *
 * Pas seulement les plus hautes : une journée basse racontée en trois lignes
 * appartient au mur autant qu'un 10. Le critère est ce qui s'est passé autour
 * — une photo, une note, des réactions — et pas la note elle-même.
 */
export function murDeSouvenirs(entrees: Entree[], limite = 12): Moment[] {
  const notes = entrees.map((entree) => {
    let points = 0;
    const raisons: string[] = [];

    // Le seuil d'entrée est 4. Une photo suffit, une vraie histoire aussi ;
    // une note courte seule non — sinon le mur devient le fil.
    // Une vidéo compte plus qu'une photo : il a fallu sortir le téléphone et
    // filmer, ce qui ne se fait pas pour un mardi comme les autres.
    const videos = entree.photos.filter((m) => m.genre === "video").length;
    if (videos) { points += 5; raisons.push(videos > 1 ? "des vidéos" : "une vidéo"); }
    else if (entree.photos.length) { points += 4; raisons.push(entree.photos.length > 1 ? "des photos" : "une photo"); }

    // Et une note vocale : c'est le jour où quelqu'un a préféré parler
    // qu'écrire. Ne pas la compter, c'était laisser au hasard sa présence sur
    // le mur — et c'est ce qui rendait l'écran différent d'une fois sur l'autre.
    if (entree.audio) { points += 4; raisons.push("une voix"); }
    if (entree.note && entree.note.length > 60) { points += 4; raisons.push("une vraie histoire"); }
    else if (entree.note) { points += 1; }

    const reactions = entree.reactions.reduce((s, r) => s + r.parQui.length, 0);
    if (reactions >= 3) { points += 3; raisons.push(`${reactions} réactions`); }
    else if (reactions > 0) points += 1;

    if (entree.commentaires.length >= 2) { points += 3; raisons.push("une conversation"); }
    else if (entree.commentaires.length === 1) { points += 1; raisons.push("un commentaire"); }

    // Un extrême ne suffit pas seul — un 10 sans rien autour n'est pas un
    // souvenir. Avec le moindre mot, il en devient un, et un 1 raconté vaut
    // exactement autant qu'un 10 raconté.
    if (entree.joie === 10) { points += 3; raisons.push("une journée à 10"); }
    if (entree.joie === 1) { points += 3; raisons.push("un jour creux assumé"); }

    return { entree, points, raison: raisons[0] ?? "" };
  });

  const classees = notes
    .filter((n) => n.points >= 4)
    // À égalité, la plus récente d'abord : un mur qui commence par 2019 ne se
    // regarde pas.
    .sort((a, b) => b.points - a.points || b.entree.jour.localeCompare(a.entree.jour));

  // Deux passes : la variété d'abord, le remplissage ensuite.
  //
  // Sans plafond par motif, une bande qui note souvent 10 obtient un mur de six
  // cartes libellées « une journée à 10 » — la même phrase répétée n'est plus
  // un souvenir, c'est une statistique. Mais un plafond seul viderait le mur
  // d'une bande qui ne fait que des photos. On préfère donc la variété, puis on
  // complète avec les meilleures restantes.
  const parRaison = new Map<string, number>();
  const retenus: Moment[] = [];
  const restants: Moment[] = [];

  for (const { entree, raison } of classees) {
    const deja = parRaison.get(raison) ?? 0;
    if (deja < MAX_PAR_RAISON && retenus.length < limite) {
      parRaison.set(raison, deja + 1);
      retenus.push({ entree, raison });
    } else {
      restants.push({ entree, raison });
    }
  }

  return [...retenus, ...restants.slice(0, Math.max(0, limite - retenus.length))];
}

const MAX_PAR_RAISON = 2;

// ── La rétrospective ─────────────────────────────────────────────────────────

export type Retrospective = {
  periode: string;
  jours: number;
  journeesPosees: number;
  moyenne: number | null;
  meilleurJour: { jour: string; moyenne: number } | null;
  plusDure: { jour: string; moyenne: number } | null;
  joursComplets: number;
  parProfil: { profil: string; posees: number; moyenne: number | null }[];
  meilleurJourSemaine: number | null;
  notesEcrites: number;
  photos: number;
  reactions: number;
  commentaires: number;
};

const NOMS_MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Le libellé d'un mois : `2026-08` → « août 2026 ». */
export function libelleMois(mois: string): string {
  const [a, m] = mois.split("-").map(Number);
  return `${NOMS_MOIS[m - 1]} ${a}`;
}

/** Les mois où la bande a posé au moins une journée, du plus récent au plus ancien. */
export function moisDisponibles(entrees: Entree[]): string[] {
  return [...new Set(entrees.map((e) => e.jour.slice(0, 7)))].sort().reverse();
}

/**
 * @param mois `AAAA-MM`, ou `AAAA` pour une année entière.
 */
export function retrospective(entrees: Entree[], mois: string, profils: string[]): Retrospective {
  const dedans = entrees.filter((e) => e.jour.startsWith(mois));

  const parJour = new Map<string, number[]>();
  for (const e of dedans) {
    if (!parJour.has(e.jour)) parJour.set(e.jour, []);
    parJour.get(e.jour)!.push(e.joie);
  }

  const journees = [...parJour.entries()]
    .map(([jour, notes]) => ({ jour, moyenne: notes.reduce((s, n) => s + n, 0) / notes.length, nombre: notes.length }))
    .sort((a, b) => a.jour.localeCompare(b.jour));

  const jourSem = Array.from({ length: 7 }, (_, index) => {
    const cible = (index + 1) % 7;
    return moyenne(dedans.filter((e) => jourSemaine(e.jour) === cible).map((e) => e.joie));
  });
  const meilleureMoyenneSem = Math.max(...jourSem.map((m) => m ?? -1));

  // Une journée « complète » est une journée où toute la bande a posté. C'est
  // la mesure du rituel, pas de l'humeur.
  const joursComplets = journees.filter((j) => j.nombre >= profils.length).length;

  const trie = [...journees].sort((a, b) => b.moyenne - a.moyenne);

  return {
    periode: mois.length === 4 ? mois : libelleMois(mois),
    jours: parJour.size,
    journeesPosees: dedans.length,
    moyenne: moyenne(dedans.map((e) => e.joie)),
    meilleurJour: trie[0] ? { jour: trie[0].jour, moyenne: trie[0].moyenne } : null,
    plusDure: trie.length > 1 ? { jour: trie.at(-1)!.jour, moyenne: trie.at(-1)!.moyenne } : null,
    joursComplets,
    parProfil: profils.map((profil) => {
      const siennes = dedans.filter((e) => e.profil === profil);
      return { profil, posees: siennes.length, moyenne: moyenne(siennes.map((e) => e.joie)) };
    }),
    meilleurJourSemaine: meilleureMoyenneSem < 0 ? null : jourSem.findIndex((m) => m === meilleureMoyenneSem),
    notesEcrites: dedans.filter((e) => e.note).length,
    photos: dedans.reduce((s, e) => s + e.photos.length, 0),
    reactions: dedans.reduce((s, e) => s + e.reactions.reduce((t, r) => t + r.parQui.length, 0), 0),
    commentaires: dedans.reduce((s, e) => s + e.commentaires.length, 0),
  };
}

/** Le jour où la bande a été la plus soudée : tout le monde présent, et haut. */
export function jourDeLaBandeEntiere(entrees: Entree[], taille: number): string | null {
  const parJour = new Map<string, number[]>();
  for (const e of entrees) {
    if (!parJour.has(e.jour)) parJour.set(e.jour, []);
    parJour.get(e.jour)!.push(e.joie);
  }
  const complets = [...parJour.entries()]
    .filter(([, notes]) => notes.length >= taille)
    .map(([jour, notes]) => ({ jour, moyenne: notes.reduce((s, n) => s + n, 0) / notes.length }))
    .sort((a, b) => b.moyenne - a.moyenne || b.jour.localeCompare(a.jour));
  return complets[0]?.jour ?? null;
}

/** Le décalage entre deux dates ISO, en jours. */
export function ecartEnJours(depuis: string, jusqua: string): number {
  let compte = 0;
  let curseur = depuis;
  while (curseur < jusqua && compte < 4000) {
    curseur = decaler(curseur, 1);
    compte += 1;
  }
  return compte;
}


/**
 * La rétrospective en une phrase.
 *
 * Elle est passée en pied de page et repliée : c'est une conclusion, pas un
 * module. Ce qui reste visible doit donc tenir en trois lignes et donner envie
 * de dérouler — ou suffire à qui ne déroulera pas.
 *
 * Les accords sont la moitié du travail. « 1 jours vécu », « 0 au complet »
 * suffisent à faire passer un résumé pour une sortie de gabarit.
 */
export function resumeRetro(donnees: Retrospective): string {
  if (donnees.journeesPosees === 0) return "Rien de posé ce mois-ci.";

  const morceaux = [
    donnees.jours === 1 ? "1 jour vécu" : `${donnees.jours} jours vécus`,
    donnees.moyenne === null
      ? null
      : `${donnees.moyenne.toFixed(1).replace(".", ",")} de moyenne`,
    donnees.joursComplets === 0
      ? null
      : donnees.joursComplets === 1
        ? "1 jour au complet"
        : `${donnees.joursComplets} jours au complet`,
  ].filter((m): m is string => m !== null);

  return `${morceaux.join(", ")}.`;
}
