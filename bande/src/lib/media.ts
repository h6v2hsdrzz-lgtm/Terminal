/**
 * Les règles de taille des médias, à part de tout ce qui touche au navigateur.
 *
 * Elles vivent ici parce qu'elles se calculent — et que ce qui se calcule doit
 * pouvoir être éprouvé. Le reste du transcodage (décoder, réencoder, muxer) ne
 * s'exécute que dans un navigateur et ne se teste que dans un vrai moteur.
 *
 * Le nerf de l'affaire est le stockage. Les médias vivent dans PostgreSQL, avec
 * les journées, et l'offre gratuite de Neon plafonne à un demi-giga-octet. Une
 * vidéo d'iPhone de huit secondes pèse une quinzaine de méga-octets : trente
 * clips suffiraient à remplir la base. Réencoder dans le navigateur avant
 * d'envoyer n'est donc pas une optimisation, c'est ce qui rend la vidéo
 * possible sans rien payer.
 */

/**
 * Le côté long d'une photo envoyée, et celui de sa miniature.
 *
 * **Deux tailles par image, jamais plus** — c'est la règle du lot M, et elle
 * tient : l'originale est convertie puis jetée, il ne reste que ces deux-là.
 *
 * 1600 pour le plein écran : un iPhone Pro Max fait 1290 pixels de large, et
 * une image plus grande que l'écran ne se voit pas, elle se télécharge.
 *
 * 640 pour la miniature, et pas 320 comme le plan le proposait. 320 conviendrait
 * à la mosaïque de la galerie — trois colonnes, cent dix points de côté — mais
 * le fil affiche la même miniature sur toute la largeur de la carte, soit trois
 * cent soixante points, donc plus de mille pixels sur un écran à trois fois.
 * Une image de 320 y serait visiblement molle. 640 est le compromis qui sert
 * correctement les deux, sans ajouter une troisième taille.
 */
export const COTE_MAX_PHOTO = 1600;
/** Le côté long d'une vidéo. 720 tient dans n'importe quel écran de téléphone. */
export const COTE_MAX_VIDEO = 720;
/** Le côté de la vignette servie au fil et à la galerie. Voir ci-dessus. */
export const COTE_VIGNETTE = 640;

/** Huit secondes. Au-delà, ce n'est plus un instant, c'est un film. */
export const DUREE_MAX_VIDEO = 8_000;
/** Images par seconde à l'encodage : au-dessus, le poids grimpe pour rien. */
export const IMAGES_PAR_SECONDE = 24;

/** Ce que le serveur accepte, et donc ce que le navigateur doit viser. */
export const POIDS_MAX_MEDIA = 4 * 1024 * 1024;

/** Combien de médias par journée. Assez pour raconter, pas pour archiver. */
export const MAX_MEDIAS = 6;

/**
 * Ce qu'on accepte de recevoir en restauration.
 *
 * Deux cent cinquante méga-octets : au-delà, une action serveur ne passe plus
 * sur Vercel, et il vaut mieux le dire tout de suite que de laisser quelqu'un
 * regarder une barre de progression pendant trois minutes pour rien. Une bande
 * plus lourde se restaure par le script de migration, depuis une machine.
 */
export const POIDS_MAX_SAUVEGARDE = 250 * 1024 * 1024;

/** Combien de vignettes la galerie dépose d'un coup. */
export const MEDIAS_PAR_PAGE = 120;

/**
 * Jusqu'où charger la galerie, pour une page demandée.
 *
 * ## Ce que ça remplace, et pourquoi
 *
 * « Tout voir » chargeait TOUT : sur une bande de trois ans, c'est plusieurs
 * milliers de cases posées d'un coup, un téléphone qui bloque plusieurs
 * secondes, et une mémoire qui se remplit pour des images qu'on ne regardera
 * pas. La suite se demande maintenant page par page, comme le fil.
 *
 * ## Ce que ce n'est PAS
 *
 * Ce n'est pas de la virtualisation : ce qui a été chargé reste dans le
 * document. Virtualiser une grille d'images à hauteur variable coûte un
 * composant de trois cents lignes et casse la position de défilement à chaque
 * retour ; pour une bande de trois personnes, une borne par page fait le même
 * travail. La décision est écrite ici pour qu'on sache qu'elle a été prise.
 *
 * La page est bornée aux deux bouts : une adresse tapée à la main
 * (`?page=99999`) ne doit pas redevenir « tout charger ».
 */
export function borneGalerie(
  page: unknown,
  total: number,
): { combien: number; suivante: number | null } {
  const pages = Math.max(1, Math.ceil(total / MEDIAS_PAR_PAGE));
  const demandee = Math.floor(Number(page));
  const courante = Number.isFinite(demandee) ? Math.min(Math.max(1, demandee), pages) : 1;
  const combien = Math.min(total, courante * MEDIAS_PAR_PAGE);
  return { combien, suivante: combien < total ? courante + 1 : null };
}

/** Deux mots sous l'image. */
export const LONGUEUR_LEGENDE = 140;

/**
 * Les dimensions d'arrivée, à proportions conservées.
 *
 * Deux précautions : on ne grandit jamais une image déjà petite — l'agrandir ne
 * lui ajoute aucun détail et ne fait que gonfler le fichier —, et les deux
 * côtés sont ramenés à un nombre pair, parce que H.264 encode par blocs de deux
 * pixels et refuse une dimension impaire.
 */
export function dimensionsCibles(
  largeur: number,
  hauteur: number,
  coteMax: number,
): { largeur: number; hauteur: number } {
  if (largeur <= 0 || hauteur <= 0) return { largeur: 0, hauteur: 0 };

  const facteur = Math.min(1, coteMax / Math.max(largeur, hauteur));
  const pair = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { largeur: pair(largeur * facteur), hauteur: pair(hauteur * facteur) };
}

/**
 * Le débit d'encodage, en bits par seconde.
 *
 * Proportionnel au nombre de pixels plutôt que fixe : un débit unique donne une
 * bouillie sur une vidéo verticale pleine cadre et gaspille sur une petite.
 * La constante vaut environ 0,07 bit par pixel et par image — le bas de la
 * fourchette habituelle pour du H.264, ce qui convient à des plans courts
 * filmés à la main.
 */
export function debitCible(largeur: number, hauteur: number): number {
  const brut = largeur * hauteur * IMAGES_PAR_SECONDE * 0.07;
  // Des bornes de part et d'autre : en dessous l'image se disloque, au-dessus
  // on dépasse le plafond de poids sans que personne ne voie la différence.
  return Math.round(Math.max(300_000, Math.min(1_600_000, brut)));
}

/**
 * Le poids attendu du fichier réencodé, pour prévenir avant de travailler.
 *
 * `duree` est en millisecondes. On compte le son en plus, à 64 kb/s.
 */
export function poidsAttendu(largeur: number, hauteur: number, duree: number): number {
  const secondes = Math.min(duree, DUREE_MAX_VIDEO) / 1000;
  return Math.round(((debitCible(largeur, hauteur) + 64_000) * secondes) / 8);
}

/** « 6 s », « 1,2 Mo » — ce qu'on montre à côté d'un média. */
export function enSecondes(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))} s`;
}

export function enPoids(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}
