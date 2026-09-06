/**
 * Quatre traits d'une personne, tirés de ses journées.
 *
 * Ce n'est pas un tableau de bord — on vient d'en retirer un. C'est un petit
 * portrait, à lire une fois de temps en temps : à quelle heure tu poses ta
 * journée, où tu es le plus souvent, à quel point tu préfères parler
 * qu'écrire, et le mot qui revient. Rien qui se compare entre nous, rien qui
 * ressemble à un score.
 *
 * Chaque trait rend `null` quand il n'y a pas de quoi le dire. Une donnée
 * absente vaut mieux qu'une donnée inventée : « 0 % de vocaux » et « on ne
 * sait pas encore » ne veulent pas dire la même chose.
 */
import { cleEtiquette } from "./etiquettes";
import type { Entree } from "./types";

/** En dessous, une moyenne ou un classement ne raconte rien. */
export const SEUIL_PORTRAIT = 5;

/**
 * L'heure moyenne de check-in, en minutes depuis minuit.
 *
 * La moyenne se prend sur un CERCLE, pas sur des nombres. Quelqu'un qui poste
 * à 23 h 50 et à 00 h 10 poste à minuit, pas à midi — et c'est très exactement
 * ce que donnerait la moyenne arithmétique de 1430 et de 10 minutes.
 */
export function heureMoyenne(entrees: Entree[]): number | null {
  const minutes = entrees
    .map((e) => enMinutes(e.posteA))
    .filter((m): m is number => m !== null);
  if (minutes.length < SEUIL_PORTRAIT) return null;

  let x = 0;
  let y = 0;
  for (const m of minutes) {
    const angle = (m / 1440) * 2 * Math.PI;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  // Tous les instants opposés deux à deux : il n'y a pas d'heure moyenne, et
  // en annoncer une serait un artefact du calcul.
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null;

  const angle = Math.atan2(y, x);
  const brut = Math.round((angle / (2 * Math.PI)) * 1440);
  return ((brut % 1440) + 1440) % 1440;
}

function enMinutes(heure: string): number | null {
  const trouve = /^(\d{1,2})[:h](\d{2})$/.exec(heure.trim());
  if (!trouve) return null;
  const h = Number(trouve[1]);
  const m = Number(trouve[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** « 21 h 40 ». */
export function enHeure(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** Le lieu qui revient le plus, et combien de fois. */
export function lieuFavori(entrees: Entree[]): { nom: string; fois: number } | null {
  const compte = new Map<string, { nom: string; fois: number }>();
  for (const entree of entrees) {
    for (const lieu of entree.etiquettes) {
      const deja = compte.get(lieu.id);
      if (deja) deja.fois += 1;
      else compte.set(lieu.id, { nom: lieu.nom, fois: 1 });
    }
  }
  const classes = [...compte.values()].sort((a, b) => b.fois - a.fois || a.nom.localeCompare(b.nom));
  // Deux occurrences, ce n'est pas une habitude.
  return classes[0] && classes[0].fois >= 3 ? classes[0] : null;
}

/** La part de journées où l'on a préféré parler qu'écrire, de 0 à 1. */
export function partVocale(entrees: Entree[]): number | null {
  if (entrees.length < SEUIL_PORTRAIT) return null;
  return entrees.filter((e) => e.audio !== null).length / entrees.length;
}

/**
 * Les mots vides du français.
 *
 * Sans cette liste, le mot le plus utilisé de tout le monde est « de ». La
 * liste est courte exprès : elle couvre ce qui domine vraiment, et rallonger
 * indéfiniment finirait par censurer des mots qui disent quelque chose.
 */
const MOTS_VIDES = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "da", "et", "ou", "mais",
  "donc", "or", "ni", "car", "que", "qui", "quoi", "dont", "ou", "a", "au",
  "aux", "en", "dans", "sur", "sous", "pour", "par", "avec", "sans", "chez",
  "vers", "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles",
  "me", "te", "se", "moi", "toi", "lui", "leur", "mon", "ma", "mes", "ton",
  "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leurs",
  "ce", "cet", "cette", "ces", "est", "sont", "etait", "ete", "suis", "es",
  "ai", "as", "ont", "avait", "avais", "fait", "faire", "plus", "moins",
  "tres", "trop", "bien", "tout", "tous", "toute", "toutes", "rien", "pas",
  "ne", "y", "si", "meme", "aussi", "alors", "encore", "deja", "quand",
  "comme", "ca", "cest", "jai", "jetais", "on", "peu", "beaucoup", "toujours",
  "jamais", "apres", "avant", "puis", "enfin", "juste",
]);

/** Le mot qui revient dans les anecdotes — hors mots vides. */
export function motFavori(entrees: Entree[]): { mot: string; fois: number } | null {
  const compte = new Map<string, { mot: string; fois: number }>();
  for (const entree of entrees) {
    if (!entree.note) continue;
    for (const brut of entree.note.split(/[^\p{L}\p{N}'-]+/u)) {
      const mot = brut.replace(/^['-]+|['-]+$/g, "");
      // Trois lettres au moins : en dessous, c'est presque toujours un mot
      // vide qui a échappé à la liste.
      if (mot.length < 4) continue;
      // La même normalisation que pour les lieux : sans accents et sans casse,
      // « déjà » et « deja » sont le même mot. Elle est déjà écrite et déjà
      // éprouvée, il n'y a aucune raison d'en avoir une seconde.
      const cle = cleEtiquette(mot);
      if (MOTS_VIDES.has(cle)) continue;
      const deja = compte.get(cle);
      if (deja) deja.fois += 1;
      else compte.set(cle, { mot: mot.toLowerCase(), fois: 1 });
    }
  }
  const classes = [...compte.values()].sort((a, b) => b.fois - a.fois || a.mot.localeCompare(b.mot));
  return classes[0] && classes[0].fois >= 3 ? classes[0] : null;
}
