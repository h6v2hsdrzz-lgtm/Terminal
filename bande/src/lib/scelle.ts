/**
 * Ce qu'on peut dire d'un scellé sans l'ouvrir.
 *
 * Le décompte se calcule, donc il se teste. Le reste — flouter l'aperçu,
 * choisir un fichier — vit dans le navigateur.
 */

/** Le côté de l'aperçu, en pixels. Trente-deux : on voit des couleurs, rien d'autre. */
export const COTE_APERCU = 32;

/** « dans 3 jours », « demain », « aujourd'hui », « dans un an et 3 mois ». */
export function decompte(ouvrirLe: string, aujourdhui: string): string {
  const jours = enJours(ouvrirLe) - enJours(aujourdhui);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "demain";
  if (jours < 31) return `dans ${jours} jours`;

  // On compte en mois d'abord, puis on répartit en années. Passer par les
  // années directement fait dire « dans 1 ans » à trois cent soixante-cinq
  // jours : le plancher tombe à zéro, le reste arrondit à douze, et on
  // rattrape en ajoutant un an à zéro.
  const moisEnTout = Math.round(jours / 30.44);
  if (moisEnTout < 12) return `dans ${moisEnTout} mois`;

  const ans = Math.floor(moisEnTout / 12);
  const mois = moisEnTout % 12;
  const partAns = ans === 1 ? "un an" : `${ans} ans`;
  if (mois === 0) return `dans ${partAns}`;
  return `dans ${partAns} et ${mois} mois`;
}

/** Le nombre de jours depuis une origine fixe. Les dates sont en `AAAA-MM-JJ`. */
function enJours(iso: string): number {
  const [a, m, j] = iso.split("-").map(Number);
  return Math.round(Date.UTC(a, m - 1, j) / 86_400_000);
}

/** Le mot qui va avec le genre, pour le sablier. */
export function nomDuGenre(genre: string): string {
  if (genre === "photo") return "une photo";
  if (genre === "video") return "une vidéo";
  if (genre === "audio") return "une voix";
  return "un mot";
}
