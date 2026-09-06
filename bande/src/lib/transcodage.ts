/**
 * Réduire une photo, réencoder une vidéo — dans le navigateur, avant l'envoi.
 *
 * Ce module ne s'exécute que côté navigateur : il touche au canevas, aux
 * éléments `<video>` et à WebCodecs. Ce qui se calcule sans DOM vit dans
 * `media.ts`, et se teste.
 *
 * ## Pourquoi réencoder au lieu d'envoyer le fichier
 *
 * Les médias vivent dans PostgreSQL, avec les journées, et l'offre gratuite de
 * Neon plafonne à un demi-giga-octet. Une vidéo d'iPhone de huit secondes pèse
 * une quinzaine de méga-octets : trente clips rempliraient la base. Réencodée à
 * 720 pixels de côté long, la même vidéo tombe autour du méga-octet — l'ordre
 * de grandeur d'une photo. Le réencodage n'est donc pas une optimisation, c'est
 * ce qui rend la vidéo possible sans rien payer.
 *
 * ## Comment
 *
 * Le décodage est confié au navigateur : on charge la vidéo dans un `<video>`
 * et on récupère les images une à une. Démuxer un MP4 à la main pour nourrir un
 * `VideoDecoder` demanderait un démuxeur complet, alors que l'élément `<video>`
 * en contient déjà un, éprouvé, et accéléré par le matériel.
 *
 * Les images sont prises en DÉPLAÇANT le curseur, pas en laissant jouer. Lire
 * pour capturer paraît plus naturel et c'est ce qui a été écrit d'abord, mais
 * ça dépend du compositeur : sans peinture à l'écran, aucune image n'arrive,
 * l'attente ne finit jamais, et l'écran reste sur « Envoi… » indéfiniment. Le
 * déplacement, lui, ne dépend que du décodeur — et il n'est pas tenu par le
 * temps réel, donc huit secondes de vidéo ne prennent pas huit secondes.
 *
 * L'encodage passe par WebCodecs (`VideoEncoder` en H.264) parce que c'est la
 * seule voie qui laisse choisir la résolution ET le débit. `MediaRecorder`
 * suivrait la cadence de lecture et ne donne aucune garantie de taille.
 *
 * ## Quand ça n'est pas possible
 *
 * WebCodecs est arrivé dans Safari 16.4. En dessous, on n'invente rien : le
 * fichier part tel quel s'il tient sous le plafond, et sinon on le dit.
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

import { COTE_APERCU } from "./scelle";
import {
  COTE_MAX_PHOTO,
  COTE_MAX_VIDEO,
  COTE_VIGNETTE,
  DUREE_MAX_VIDEO,
  IMAGES_PAR_SECONDE,
  POIDS_MAX_MEDIA,
  debitCible,
  dimensionsCibles,
} from "./media";

export type MediaPret = {
  genre: "photo" | "video";
  blob: Blob;
  largeur: number;
  hauteur: number;
  duree: number | null;
  /** Toujours du JPEG. */
  vignette: Blob | null;
};

/** Ce que le navigateur en présence sait faire. */
export function videoReencodable(): boolean {
  return typeof window !== "undefined" && typeof window.VideoEncoder === "function";
}

// ── Images ───────────────────────────────────────────────────────────────────

async function versJpeg(source: CanvasImageSource, l: number, h: number, qualite: number) {
  const toile = document.createElement("canvas");
  toile.width = l;
  toile.height = h;
  const ctx = toile.getContext("2d");
  if (!ctx) throw new Error("toile indisponible");
  ctx.drawImage(source, 0, 0, l, h);
  const blob = await new Promise<Blob | null>((ok) => toile.toBlob(ok, "image/jpeg", qualite));
  if (!blob) throw new Error("compression impossible");
  return blob;
}

/**
 * Une photo réduite, avec sa vignette.
 *
 * `createImageBitmap` décode hors du fil principal et respecte l'orientation
 * EXIF, ce qu'une balise `<img>` ne fait pas de façon fiable — une photo prise
 * en tenant le téléphone de travers arriverait couchée.
 */
export async function preparerPhoto(fichier: File): Promise<MediaPret> {
  const image = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  try {
    const grand = dimensionsCibles(image.width, image.height, COTE_MAX_PHOTO);
    const petit = dimensionsCibles(image.width, image.height, COTE_VIGNETTE);
    return {
      genre: "photo",
      blob: await versJpeg(image, grand.largeur, grand.hauteur, 0.82),
      largeur: grand.largeur,
      hauteur: grand.hauteur,
      duree: null,
      vignette: await versJpeg(image, petit.largeur, petit.hauteur, 0.72),
    };
  } finally {
    image.close();
  }
}

// ── Vidéos ───────────────────────────────────────────────────────────────────

/** Charge la vidéo et attend d'en connaître les dimensions et la durée. */
function ouvrirVideo(fichier: File): Promise<{ video: HTMLVideoElement; liberer: () => void }> {
  return new Promise((ok, non) => {
    const url = URL.createObjectURL(fichier);
    const video = document.createElement("video");
    // `playsInline` et `muted` : sans eux, iOS refuse de lire sans geste et
    // bascule en plein écran, ce qui interromprait la capture des images.
    video.playsInline = true;
    video.muted = true;
    video.preload = "auto";
    const liberer = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      URL.revokeObjectURL(url);
    };

    // Dans le document, et non détaché : un élément qui n'est nulle part n'est
    // peint par personne, et `drawImage` en tire une image vide. Il est réduit
    // à un pixel presque transparent plutôt que masqué — `display:none` et
    // `visibility:hidden` dispensent le moteur de le rendre, ce qui ramène au
    // même problème.
    video.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1";
    document.body.appendChild(video);
    video.onloadedmetadata = () => ok({ video, liberer });
    video.onerror = () => {
      liberer();
      non(new Error("vidéo illisible"));
    };
    video.src = url;
  });
}

/** La première image, pour la vignette et pour l'aperçu du fil. */
async function premiereImage(video: HTMLVideoElement, l: number, h: number): Promise<Blob> {
  // Un poil après le début : la toute première image d'une vidéo tournée à la
  // main est souvent floue ou noire.
  await placer(video, Math.min(0.15, (video.duration || 1) / 4));
  return versJpeg(video, l, h, 0.72);
}

/**
 * Place le curseur et attend que l'image soit prête — mais pas indéfiniment.
 *
 * Un déplacement qui n'aboutit pas n'émet jamais « seeked ». Sans ce délai,
 * l'attente ne finirait jamais et l'écran resterait sur « Envoi… » pour
 * toujours : c'est très exactement le défaut que la capture par lecture avait,
 * et il n'y a aucune raison de le réintroduire ici. Au pire on dessine l'image
 * en place, qui est celle d'avant — un doublon dans la vidéo, pas un blocage.
 */
function placer(video: HTMLVideoElement, seconde: number, delai = 3000): Promise<void> {
  return new Promise((ok) => {
    let rendu = false;
    const fini = () => {
      if (rendu) return;
      rendu = true;
      clearTimeout(minuteur);
      video.removeEventListener("seeked", fini);
      ok();
    };
    const minuteur = setTimeout(fini, delai);
    video.addEventListener("seeked", fini);
    video.currentTime = seconde;
  });
}

/**
 * Réencode une vidéo à la taille et au débit visés.
 *
 * La lecture se fait à vitesse normale : on ne peut pas décoder plus vite que
 * le navigateur ne joue. Huit secondes de vidéo prennent donc huit secondes, et
 * l'appelant reçoit l'avancement pour le dire à l'écran plutôt que de laisser
 * croire à un blocage.
 */
export async function preparerVideo(
  fichier: File,
  avancement?: (part: number) => void,
): Promise<MediaPret> {
  const { video, liberer } = await ouvrirVideo(fichier);
  try {
    const source = { l: video.videoWidth, h: video.videoHeight };
    if (!source.l || !source.h) throw new Error("vidéo sans image");

    const cible = dimensionsCibles(source.l, source.h, COTE_MAX_VIDEO);
    const petit = dimensionsCibles(source.l, source.h, COTE_VIGNETTE);
    const duree = Math.min((video.duration || 0) * 1000, DUREE_MAX_VIDEO);
    const vignette = await premiereImage(video, petit.largeur, petit.hauteur);

    if (!videoReencodable()) {
      // Sans WebCodecs on n'invente rien : ou le fichier tient tel quel, ou on
      // le dit. Le tronquer sans réencoder n'est pas possible sans démuxeur.
      if (fichier.size > POIDS_MAX_MEDIA) {
        throw new ErreurTranscodage(
          "Ce navigateur ne sait pas réduire une vidéo, et celle-ci est trop lourde. " +
            "Mets à jour iOS, ou choisis un extrait plus court.",
        );
      }
      return {
        genre: "video",
        blob: fichier,
        largeur: source.l,
        hauteur: source.h,
        duree: Math.round((video.duration || 0) * 1000),
        vignette,
      };
    }

    const muxeur = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: cible.largeur, height: cible.hauteur },
      // `fragmented` non : un MP4 classique place l'index en tête après coup,
      // ce qui laisse Safari connaître la durée avant d'avoir tout reçu.
      fastStart: "in-memory",
    });

    let erreur: unknown = null;
    const encodeur = new VideoEncoder({
      output: (morceau, meta) => muxeur.addVideoChunk(morceau, meta),
      error: (e) => { erreur = e; },
    });
    encodeur.configure({
      codec: "avc1.42001f", // Baseline 3.1 : le profil que tout lit.
      width: cible.largeur,
      height: cible.hauteur,
      bitrate: debitCible(cible.largeur, cible.hauteur),
      framerate: IMAGES_PAR_SECONDE,
      latencyMode: "quality",
    });

    const toile = document.createElement("canvas");
    toile.width = cible.largeur;
    toile.height = cible.hauteur;
    const ctx = toile.getContext("2d");
    if (!ctx) throw new Error("toile indisponible");

    const total = Math.max(1, Math.round((duree / 1000) * IMAGES_PAR_SECONDE));
    let images = 0;

    for (let i = 0; i < total; i += 1) {
      if (erreur) break;
      const instant = i / IMAGES_PAR_SECONDE;
      // Un déplacement au-delà de la fin ne déclenche jamais « seeked » : on
      // s'arrête un cheveu avant plutôt que d'attendre un événement qui ne
      // viendra pas.
      if (instant >= (video.duration || 0) - 1 / (IMAGES_PAR_SECONDE * 2)) break;

      await placer(video, instant);
      ctx.drawImage(video, 0, 0, cible.largeur, cible.hauteur);
      const image = new VideoFrame(toile, {
        timestamp: Math.round(instant * 1e6),
        duration: Math.round(1e6 / IMAGES_PAR_SECONDE),
      });
      // Une image clé toutes les deux secondes : c'est ce qui permet de
      // déplacer le curseur sans redécoder depuis le début.
      encodeur.encode(image, { keyFrame: i % (IMAGES_PAR_SECONDE * 2) === 0 });
      image.close();
      images += 1;
      avancement?.((i + 1) / total);
    }

    await encodeur.flush();
    encodeur.close();
    if (erreur) throw erreur;
    if (images === 0) throw new ErreurTranscodage("Aucune image n'a pu être lue de cette vidéo.");

    muxeur.finalize();
    const tampon = (muxeur.target as ArrayBufferTarget).buffer;
    const blob = new Blob([tampon], { type: "video/mp4" });

    if (blob.size > POIDS_MAX_MEDIA) {
      throw new ErreurTranscodage("Cette vidéo reste trop lourde. Essaie un extrait plus court.");
    }

    return {
      genre: "video",
      blob,
      largeur: cible.largeur,
      hauteur: cible.hauteur,
      duree: Math.round(duree),
      vignette,
    };
  } finally {
    liberer();
  }
}

/** Une erreur qu'on peut montrer telle quelle : elle est écrite pour être lue. */
export class ErreurTranscodage extends Error {}

/** Photo ou vidéo, selon ce que le fichier annonce. */
export async function preparerMedia(
  fichier: File,
  avancement?: (part: number) => void,
): Promise<MediaPret> {
  return fichier.type.startsWith("video/")
    ? preparerVideo(fichier, avancement)
    : preparerPhoto(fichier);
}


// ── Scellés ──────────────────────────────────────────────────────────────────

/**
 * L'aperçu d'un scellé : l'image réduite à trente-deux pixels de côté.
 *
 * Le flou est DANS LES OCTETS, pas dans une règle CSS. Envoyer l'image nette et
 * la flouter à l'affichage reviendrait à la donner et à demander poliment de
 * ne pas regarder — trois clics dans les outils du navigateur suffiraient. À
 * cette taille, il ne reste que des masses de couleur : on voit qu'il y a
 * quelque chose, on ne voit pas quoi, et c'est exactement ce qu'un sablier
 * doit montrer.
 *
 * Pour une vidéo, on prend une image du début ; pour un son, il n'y a rien à
 * montrer et l'appelant s'en passe.
 */
export async function apercuScelle(source: CanvasImageSource): Promise<Blob> {
  return versJpeg(source, COTE_APERCU, COTE_APERCU, 0.6);
}

/** Ce qu'un scellé emporte : le contenu réduit, et son aperçu illisible. */
export type ScellePret = {
  genre: "photo" | "video" | "audio";
  blob: Blob;
  apercu: Blob | null;
  duree: number | null;
};

export async function preparerScelle(
  fichier: File,
  avancement?: (part: number) => void,
): Promise<ScellePret> {
  if (fichier.type.startsWith("audio/")) {
    // Un son ne se réduit pas ici : il vient de l'enregistreur, qui a déjà
    // choisi son format et sa durée.
    return { genre: "audio", blob: fichier, apercu: null, duree: null };
  }

  const pret = await preparerMedia(fichier, avancement);
  const image = await createImageBitmap(pret.vignette ?? pret.blob);
  try {
    return {
      genre: pret.genre === "video" ? "video" : "photo",
      blob: pret.blob,
      apercu: await apercuScelle(image),
      duree: pret.duree,
    };
  } finally {
    image.close();
  }
}
