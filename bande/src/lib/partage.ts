import { couleurJoie, couleurProfil } from "./couleurs";
import { enTexteLong } from "./dates";
import type { Entree, Profil } from "./types";

/**
 * Partager une journée en image.
 *
 * Une carte 9:16 dessinée en canvas, aux dimensions d'une story — c'est le
 * format de la conversation de groupe, et c'est là que ça part.
 *
 * Pourquoi un canvas plutôt qu'une capture du DOM : une capture demande une
 * bibliothèque de plusieurs centaines de kilo-octets qui réimplémente le
 * rendu CSS, se trompe sur les polices, et rate systématiquement les images
 * d'une autre origine. Le canvas est natif, tient en un fichier, et donne
 * exactement la même image sur les trois téléphones.
 *
 * Ce fichier ne touche jamais au serveur : il ne lit que ce que la carte
 * affiche déjà, et une journée voilée n'a rien à afficher.
 */
export const LARGEUR = 1080;
export const HAUTEUR = 1920;

const MARGE = 96;

/** Découpe un texte à la largeur donnée, et rend les lignes. */
export function couperEnLignes(
  contexte: CanvasRenderingContext2D,
  texte: string,
  largeur: number,
  maximum: number,
): string[] {
  const lignes: string[] = [];
  let courante = "";
  for (const mot of texte.split(/\s+/)) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (contexte.measureText(essai).width > largeur && courante) {
      lignes.push(courante);
      courante = mot;
      if (lignes.length === maximum) break;
    } else {
      courante = essai;
    }
  }
  if (lignes.length < maximum && courante) lignes.push(courante);
  // Le dernier mot coupé se voit : mieux vaut le dire que laisser croire que
  // la note s'arrêtait là.
  if (lignes.length === maximum && contexte.measureText(texte).width > largeur * maximum) {
    lignes[maximum - 1] = `${lignes[maximum - 1]}…`;
  }
  return lignes;
}

function coinsArrondis(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  l: number,
  h: number,
  r: number,
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + l, y, x + l, y + h, r);
  c.arcTo(x + l, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + l, y, r);
  c.closePath();
}

/** Charge une image de notre propre origine. Rend `null` si elle ne vient pas. */
async function chargerImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resoudre) => {
    const image = new Image();
    image.onload = () => resoudre(image);
    image.onerror = () => resoudre(null);
    image.src = url;
  });
}

/**
 * Une variable CSS n'est pas une couleur pour un canvas.
 *
 * `couleurProfil` rend `var(--profil-4)` — parfait en CSS, illisible pour un
 * contexte 2D. Et le canvas ne se contente pas de l'ignorer : `addColorStop`
 * **lève** sur une couleur invalide, au milieu du dessin, et l'image entière
 * disparaît sans que rien ne l'explique. C'est exactement ce qui est arrivé.
 *
 * La lecture est passée en paramètre pour que la fonction se teste sans DOM.
 */
export function resoudreCouleur(valeur: string, lire: (nom: string) => string): string {
  const trouve = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(valeur.trim());
  if (!trouve) return valeur;
  // Un gris neutre plutôt qu'une exception : une carte à la mauvaise teinte
  // reste une carte, une carte qui n'existe pas ne se partage pas.
  return lire(trouve[1]).trim() || "#8a8a8a";
}

function couleurLue(valeur: string): string {
  const lu = getComputedStyle(document.documentElement);
  return resoudreCouleur(valeur, (nom) => lu.getPropertyValue(nom));
}

export type StylePartage = {
  sol: string;
  surface: string;
  encre: string;
  encreDouce: string;
  trait: string;
};

/** Les couleurs du thème en cours, lues sur la page plutôt que recopiées. */
export function styleCourant(): StylePartage {
  const lu = getComputedStyle(document.documentElement);
  const valeur = (nom: string, secours: string) =>
    lu.getPropertyValue(nom).trim() || secours;
  return {
    sol: valeur("--sol", "#fbfaf8"),
    surface: valeur("--surface", "#ffffff"),
    encre: valeur("--encre", "#16181c"),
    encreDouce: valeur("--encre-3", "#7c7a75"),
    trait: valeur("--trait", "#e7e4de"),
  };
}

/**
 * Dessine la carte et rend le canvas.
 *
 * Séparé de l'envoi pour être regardable : on peut appeler ça dans un test et
 * comparer l'image, alors que `navigator.share` n'existe nulle part ailleurs
 * que sur un téléphone.
 */
export async function dessinerJournee(options: {
  entree: Entree;
  profil: Profil;
  bande: string;
  style: StylePartage;
  /** Rendu injectable pour les tests ; sinon un canvas du document. */
  canvas?: HTMLCanvasElement;
}): Promise<HTMLCanvasElement> {
  const { entree, profil, bande, style } = options;
  const canvas = options.canvas ?? document.createElement("canvas");
  canvas.width = LARGEUR;
  canvas.height = HAUTEUR;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Ce navigateur ne sait pas dessiner de canvas.");

  const couleur = couleurLue(couleurProfil(profil));

  c.fillStyle = style.sol;
  c.fillRect(0, 0, LARGEUR, HAUTEUR);

  // Une seule touche de couleur en haut, celle de la personne : la carte doit
  // se reconnaître d'un coup d'œil dans une conversation.
  const degrade = c.createLinearGradient(0, 0, 0, 520);
  degrade.addColorStop(0, couleur);
  degrade.addColorStop(1, style.sol);
  c.globalAlpha = 0.22;
  c.fillStyle = degrade;
  c.fillRect(0, 0, LARGEUR, 520);
  c.globalAlpha = 1;

  c.textBaseline = "top";
  c.fillStyle = style.encreDouce;
  c.font = "500 34px Inter, system-ui, sans-serif";
  c.fillText(bande.toUpperCase(), MARGE, 120);

  c.fillStyle = style.encre;
  c.font = "600 56px Inter, system-ui, sans-serif";
  c.fillText(enTexteLong(entree.jour), MARGE, 176);

  // Le disque de la note, à droite, comme sur la carte du fil.
  const rayon = 92;
  const cx = LARGEUR - MARGE - rayon;
  const cy = 176 + rayon - 20;
  c.beginPath();
  c.arc(cx, cy, rayon, 0, Math.PI * 2);
  c.fillStyle = couleurLue(couleurJoie(entree.joie));
  c.fill();
  c.fillStyle = style.encre;
  c.font = "600 78px Inter, system-ui, sans-serif";
  c.textAlign = "center";
  c.fillText(String(entree.joie), cx, cy - 46);
  c.textAlign = "left";

  let y = 368;

  // La photo, si elle existe : recadrée en 4:3, coins arrondis.
  const photo = entree.photos.find((p) => p.genre === "photo");
  if (photo) {
    const image = await chargerImage(photo.url);
    if (image) {
      const l = LARGEUR - MARGE * 2;
      const h = Math.round((l * 3) / 4);
      c.save();
      coinsArrondis(c, MARGE, y, l, h, 40);
      c.clip();
      // « cover » : on remplit le cadre sans déformer, quitte à rogner.
      const echelle = Math.max(l / image.width, h / image.height);
      const il = image.width * echelle;
      const ih = image.height * echelle;
      c.drawImage(image, MARGE + (l - il) / 2, y + (h - ih) / 2, il, ih);
      c.restore();
      y += h + 56;
    }
  }

  /**
   * Le texte est centré dans ce qui reste, pas collé sous la photo.
   *
   * Une carte 9:16 laisse beaucoup de place ; un titre de trois mots posé en
   * haut d'un vide de six cents pixels a l'air d'une erreur de chargement. On
   * mesure donc le bloc avant de le poser, puis on le centre entre la photo et
   * la signature.
   */
  const TITRE = "600 68px Inter, system-ui, sans-serif";
  const NOTE = "400 44px Inter, system-ui, sans-serif";
  const ETIQUETTE = "500 34px Inter, system-ui, sans-serif";
  const largeurTexte = LARGEUR - MARGE * 2;
  const basDuBloc = HAUTEUR - 300;

  c.font = TITRE;
  const lignesTitre = entree.titre ? couperEnLignes(c, entree.titre, largeurTexte, 2) : [];
  c.font = NOTE;
  const lignesNote = entree.note
    ? couperEnLignes(c, entree.note, largeurTexte, photo ? 5 : 12)
    : [];

  const hauteurBloc =
    lignesTitre.length * 82 +
    (lignesTitre.length ? 16 : 0) +
    lignesNote.length * 62 +
    (lignesNote.length ? 24 : 0) +
    (entree.etiquettes.length > 0 ? 62 : 0);

  y += Math.max(0, (basDuBloc - y - hauteurBloc) / 2);

  if (lignesTitre.length) {
    c.fillStyle = style.encre;
    c.font = TITRE;
    for (const ligne of lignesTitre) {
      c.fillText(ligne, MARGE, y);
      y += 82;
    }
    y += 16;
  }

  if (lignesNote.length) {
    c.fillStyle = style.encre;
    c.font = NOTE;
    // Ce qui ne tient pas est coupé, pas rétréci : une image de partage
    // illisible ne partage rien.
    for (const ligne of lignesNote) {
      c.fillText(ligne, MARGE, y);
      y += 62;
    }
    y += 24;
  }

  // Les étiquettes, en pilules, tant qu'il reste de la place.
  if (entree.etiquettes.length > 0 && y < basDuBloc) {
    let x = MARGE;
    c.font = ETIQUETTE;
    for (const etiquette of entree.etiquettes) {
      const l = c.measureText(etiquette.nom).width + 56;
      if (x + l > LARGEUR - MARGE) break;
      coinsArrondis(c, x, y, l, 62, 31);
      c.fillStyle = style.surface;
      c.fill();
      c.strokeStyle = style.trait;
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = style.encre;
      c.fillText(etiquette.nom, x + 28, y + 14);
      x += l + 16;
    }
  }

  // Le pied : l'avatar, le prénom, l'heure. Toujours à la même hauteur, quelle
  // que soit la longueur de la note — une signature qui flotte n'en est pas une.
  const pied = HAUTEUR - 220;
  const avatar = profil.avatar ? await chargerImage(profil.avatar) : null;
  const taille = 96;
  c.save();
  c.beginPath();
  c.arc(MARGE + taille / 2, pied + taille / 2, taille / 2, 0, Math.PI * 2);
  c.closePath();
  c.fillStyle = couleur;
  c.fill();
  if (avatar) {
    c.clip();
    c.drawImage(avatar, MARGE, pied, taille, taille);
  }
  c.restore();
  if (!avatar) {
    c.fillStyle = style.encre;
    c.font = "600 40px Inter, system-ui, sans-serif";
    c.textAlign = "center";
    c.fillText(profil.initiales, MARGE + taille / 2, pied + 26);
    c.textAlign = "left";
  }

  c.fillStyle = style.encre;
  c.font = "600 44px Inter, system-ui, sans-serif";
  c.fillText(profil.pseudo, MARGE + taille + 28, pied + 8);
  c.fillStyle = style.encreDouce;
  c.font = "400 34px Inter, system-ui, sans-serif";
  c.fillText(`posté à ${entree.posteA}`, MARGE + taille + 28, pied + 58);

  return canvas;
}

/**
 * Dessine, puis propose de partager.
 *
 * `navigator.share` avec un fichier est la seule voie qui mène à la
 * conversation de groupe depuis iOS ; quand il n'est pas là (bureau, WebKit
 * automatisé), on retombe sur un téléchargement, qui marche partout.
 */
export async function partagerJournee(options: {
  entree: Entree;
  profil: Profil;
  bande: string;
}): Promise<"partage" | "telechargement"> {
  const canvas = await dessinerJournee({ ...options, style: styleCourant() });
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("L'image n'a pas pu être fabriquée.");

  const nom = `journee-${options.profil.pseudo}-${options.entree.jour}.png`;
  const fichier = new File([blob], nom, { type: "image/png" });

  // `canShare` avant `share` : sur un navigateur qui a l'un sans l'autre,
  // appeler `share` lève et on perd l'image sans rien proposer.
  if (navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier] });
      return "partage";
    } catch (erreur) {
      // Annuler le panneau de partage n'est pas une erreur : on ne retombe
      // pas sur un téléchargement que personne n'a demandé.
      if (erreur instanceof DOMException && erreur.name === "AbortError") return "partage";
    }
  }

  // Deux détails qui ont coûté une soirée :
  //
  // · le lien doit être **dans le document**. Safari ignore le clic
  //   programmatique sur un `<a>` détaché, sans la moindre erreur ;
  // · l'adresse ne se révoque pas dans la foulée du clic. Le téléchargement
  //   n'a pas encore commencé, et révoquer l'annule silencieusement. On rend
  //   la mémoire au tour suivant, quand le navigateur a eu le sien.
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  lien.style.display = "none";
  document.body.append(lien);
  lien.click();
  setTimeout(() => {
    lien.remove();
    URL.revokeObjectURL(url);
  }, 1000);
  return "telechargement";
}
