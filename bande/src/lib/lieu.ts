/**
 * Le lieu : ce qu'on en garde, et ce qu'on n'en garde pas.
 *
 * On stocke un LIBELLÉ — « Le canal », « Chez Mamie » — et, pour la carte, des
 * coordonnées volontairement grossières. Jamais la position exacte : elle dit
 * l'immeuble, parfois l'appartement, et personne n'a besoin de ça pour se
 * souvenir d'une soirée.
 */

/**
 * Deux décimales, soit environ un kilomètre.
 *
 * C'est assez pour poser un point sur une carte et reconnaître un quartier ;
 * ce n'est pas assez pour retrouver une adresse. Le compromis est délibéré, et
 * l'arrondi se fait AVANT le stockage — arrondir à l'affichage laisserait la
 * précision en base, où elle finirait par ressortir.
 */
export const DECIMALES = 2;

export function arrondirPosition(latitude: number, longitude: number) {
  const facteur = 10 ** DECIMALES;
  return {
    latitude: Math.round(latitude * facteur) / facteur,
    longitude: Math.round(longitude * facteur) / facteur,
  };
}

/**
 * Le nom d'un lieu, tiré d'une réponse de Nominatim.
 *
 * On cherche le plus précis qui reste lisible : le quartier plutôt que la rue
 * (la rue est déjà trop), la ville à défaut. Un libellé de trois lignes avec
 * le code postal et le pays ne tient pas dans une pastille.
 */
export function nomDuLieu(adresse: Record<string, string> | undefined): string | null {
  if (!adresse) return null;
  const quartier =
    adresse.neighbourhood ?? adresse.suburb ?? adresse.city_district ?? adresse.hamlet ?? null;
  const ville = adresse.city ?? adresse.town ?? adresse.village ?? adresse.municipality ?? null;

  if (quartier && ville && quartier !== ville) return `${quartier}, ${ville}`;
  return quartier ?? ville ?? adresse.county ?? adresse.state ?? null;
}

/** La clé de cache d'une position arrondie. */
export function cleCache(latitude: number, longitude: number): string {
  const { latitude: la, longitude: lo } = arrondirPosition(latitude, longitude);
  return `${la.toFixed(DECIMALES)},${lo.toFixed(DECIMALES)}`;
}

/**
 * La constellation : placer des lieux les uns par rapport aux autres.
 *
 * ## Pourquoi ce n'est pas une projection linéaire
 *
 * La première version l'était, et la capture a montré ce qu'elle valait : cinq
 * lieux parisiens écrasés en une seule tache, cinq étiquettes empilées, plus
 * rien de lisible — parce qu'un lieu à Nantes fixait l'échelle et que trois
 * cents kilomètres écrasent trois kilomètres. C'est mathématiquement juste et
 * visuellement inutile.
 *
 * On mélange donc deux placements :
 *
 * - **le linéaire**, qui dit la distance vraie mais tasse les grappes ;
 * - **le rang**, qui répartit les lieux à intervalles réguliers et sépare les
 *   grappes mais efface la distance.
 *
 * Le mélange garde l'essentiel de chacun : l'échappée reste visiblement loin,
 * la grappe du quotidien s'ouvre assez pour qu'on lise les noms. L'ORDRE est
 * conservé dans les deux axes — un lieu à l'ouest d'un autre reste à sa
 * gauche — et deux positions identiques donnent le même point.
 *
 * Ce n'est pas une carte, et la légende le dit. Une carte au kilomètre près
 * qui prétendrait à l'exactitude mentirait davantage.
 */
const PART_LINEAIRE = 0.45;

export type LieuSitue = { id: string; nom: string; usages: number; latitude: number; longitude: number };
export type PointConstellation = { id: string; nom: string; usages: number; x: number; y: number };

/** Le rang de chaque valeur dans [0, 1], les ex æquo au même rang. */
function rangs(valeurs: number[]): number[] {
  const triees = [...new Set(valeurs)].sort((a, b) => a - b);
  const dernier = triees.length - 1;
  return valeurs.map((v) => (dernier === 0 ? 0.5 : triees.indexOf(v) / dernier));
}

/** La part linéaire dans [0, 1] ; tout au milieu si tout est au même endroit. */
function lineaires(valeurs: number[]): number[] {
  const bas = Math.min(...valeurs);
  const haut = Math.max(...valeurs);
  const etendue = haut - bas;
  return valeurs.map((v) => (etendue === 0 ? 0.5 : (v - bas) / etendue));
}

function melange(valeurs: number[]): number[] {
  const l = lineaires(valeurs);
  const r = rangs(valeurs);
  return valeurs.map((_, i) => PART_LINEAIRE * l[i] + (1 - PART_LINEAIRE) * r[i]);
}

export function constellation(
  lieux: LieuSitue[],
  taille: number,
  marge: number,
): PointConstellation[] {
  const utile = taille - 2 * marge;
  const xs = melange(lieux.map((l) => l.longitude));
  // La latitude monte vers le nord, l'axe des ordonnées d'un SVG descend.
  const ys = melange(lieux.map((l) => l.latitude));
  return lieux.map((lieu, i) => ({
    id: lieu.id,
    nom: lieu.nom,
    usages: lieu.usages,
    x: marge + xs[i] * utile,
    y: marge + (1 - ys[i]) * utile,
  }));
}

/**
 * Où poser l'étiquette d'un point sans écraser celle du voisin.
 *
 * Au-dessus par défaut, en dessous si la place est déjà prise, puis décalée
 * vers le bas jusqu'à ce qu'elle soit libre. Les boîtes sont estimées — on ne
 * mesure pas du texte hors du navigateur — mais une estimation large vaut
 * mieux que deux noms superposés.
 */
export const HAUTEUR_ETIQUETTE = 12;
const LARGEUR_CARACTERE = 5.2;

export type Etiquette = { x: number; y: number; ancre: "start" | "middle" | "end" };

export function poserEtiquettes(
  points: { nom: string; x: number; y: number; r: number }[],
  taille: number,
): Etiquette[] {
  const posees: { gauche: number; droite: number; haut: number; bas: number }[] = [];
  // Du plus haut au plus bas : l'ordre de pose décide qui garde sa place, et
  // le faire dans l'ordre de la liste donnerait un résultat imprévisible.
  const ordre = points.map((_, i) => i).sort((a, b) => points[a].y - points[b].y);
  const resultat = new Array<Etiquette>(points.length);

  for (const i of ordre) {
    const p = points[i];
    const demi = (p.nom.length * LARGEUR_CARACTERE) / 2;
    // Un nom collé au bord sortirait du cadre : on ancre au bord plutôt que
    // de le centrer sur un point qui n'a pas la place.
    const ancre: Etiquette["ancre"] = p.x - demi < 2 ? "start" : p.x + demi > taille - 2 ? "end" : "middle";
    const gauche = ancre === "start" ? p.x : ancre === "end" ? p.x - 2 * demi : p.x - demi;
    const droite = gauche + 2 * demi;

    const candidats = [p.y - p.r - 5, p.y + p.r + HAUTEUR_ETIQUETTE];
    for (let pas = 1; pas <= 6; pas++) candidats.push(p.y + p.r + HAUTEUR_ETIQUETTE * (1 + pas));

    const y =
      candidats.find((c) => {
        if (c < HAUTEUR_ETIQUETTE || c > taille) return false;
        return !posees.some(
          (b) =>
            gauche < b.droite && droite > b.gauche && c - HAUTEUR_ETIQUETTE < b.bas && c > b.haut,
        );
      }) ?? candidats[0];

    posees.push({ gauche, droite, haut: y - HAUTEUR_ETIQUETTE, bas: y });
    resultat[i] = { x: p.x, y, ancre };
  }
  return resultat;
}
