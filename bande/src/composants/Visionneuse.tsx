"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { actionReagir } from "@/lib/actions";
import { enSecondes } from "@/lib/media";
import type { Media } from "@/lib/types";

/**
 * Le plein écran, à la hauteur d'une vraie application photo.
 *
 * ## Pourquoi le défilement n'est plus natif ici
 *
 * Le carrousel du fil s'appuie sur `scroll-snap`, et c'est le bon choix : il
 * est imbriqué dans une page qui défile, et réimplémenter le geste s'y
 * bagarrerait avec celui du système. Le plein écran, lui, est une couche
 * modale : il n'y a plus de page derrière, plus de geste système à préserver,
 * et le pincement exige `touch-action: none` — qui tuerait justement le
 * défilement natif. Ici, on prend donc la main.
 *
 * ## Les gestes, et pourquoi ceux-là
 *
 * · **pincer** pour zoomer, autour du milieu des deux doigts ;
 * · **glisser** pour se déplacer dans l'image zoomée, ou pour passer à la
 *   suivante quand elle ne l'est pas ;
 * · **glisser vers le bas** pour fermer, avec l'image qui suit le doigt ;
 * · **toucher deux fois** pour réagir. Le plan demandait aussi le double-tap
 *   pour zoomer : les deux ne peuvent pas coexister sur le même geste, et
 *   entre « zoomer » — que le pincement fait déjà — et « aimer » — qui n'a pas
 *   d'autre geste — le choix se tranche tout seul ;
 * · **toucher une fois** pour masquer l'habillage et ne plus voir que l'image.
 *
 * `100dvh` et non `100vh` : sur iOS, `vh` compte la barre d'adresse même
 * rétractée, et l'image dépasserait sous le bord de l'écran.
 */
const ZOOM_MAX = 4;
/** Au-delà, le glissement vers le bas ferme au relâchement. */
const SEUIL_FERMETURE = 110;
/** En deçà, un glissement horizontal ne change pas d'image. */
const SEUIL_PAGE = 60;
/** Deux touchers plus espacés que ça sont deux touchers, pas un double. */
const DELAI_DOUBLE = 280;

type Transformation = { echelle: number; x: number; y: number };
const REPOS: Transformation = { echelle: 1, x: 0, y: 0 };

export function Visionneuse({
  photos,
  depart,
  legende,
  fermer,
  pied,
  moi,
}: {
  photos: Media[];
  depart: number;
  legende: string;
  fermer: () => void;
  /** De quoi situer le média courant — la galerie y met le jour et l'auteur. */
  pied?: (media: Media) => string | null;
  /**
   * Donné, le double-tap pose une réaction. La visionneuse ne sait pas à quelle
   * journée appartient le média : c'est l'appelant qui le dit.
   */
  moi?: { entreeDe: (media: Media) => string | null };
}) {
  const [index, setIndex] = useState(depart);
  const [vue, setVue] = useState<Transformation>(REPOS);
  const [glisse, setGlisse] = useState({ x: 0, y: 0 });
  const [habillage, setHabillage] = useState(true);
  const [coeur, setCoeur] = useState(0);
  // Un état, pas une lecture de référence pendant le rendu : le nombre de
  // doigts décide s'il faut animer la transformation, et une référence lue au
  // rendu ne provoque aucun nouveau rendu quand elle change.
  const [enGeste, setEnGeste] = useState(false);

  const doigts = useRef(new Map<number, { x: number; y: number }>());
  const debut = useRef<{ x: number; y: number; vue: Transformation } | null>(null);
  const ecartDepart = useRef(0);
  const dernierToucher = useRef(0);
  const courant = photos[index];

  const allerA = useCallback(
    (suivant: number) => {
      if (suivant < 0 || suivant >= photos.length) return;
      setIndex(suivant);
      setVue(REPOS);
      setGlisse({ x: 0, y: 0 });
    },
    [photos.length],
  );

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Escape") fermer();
      if (e.key === "ArrowRight") allerA(index + 1);
      if (e.key === "ArrowLeft") allerA(index - 1);
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [fermer, allerA, index]);

  const ecart = () => {
    const [a, b] = [...doigts.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  function prendre(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    doigts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setEnGeste(true);
    if (doigts.current.size === 2) {
      ecartDepart.current = ecart();
      debut.current = null;
    } else {
      debut.current = { x: e.clientX, y: e.clientY, vue };
    }
  }

  function bouger(e: React.PointerEvent) {
    if (!doigts.current.has(e.pointerId)) return;
    doigts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (doigts.current.size === 2) {
      const facteur = ecart() / (ecartDepart.current || 1);
      setVue((v) => ({ ...v, echelle: Math.max(1, Math.min(ZOOM_MAX, v.echelle * facteur)) }));
      ecartDepart.current = ecart();
      return;
    }

    if (!debut.current) return;
    const dx = e.clientX - debut.current.x;
    const dy = e.clientY - debut.current.y;

    if (debut.current.vue.echelle > 1) {
      // Zoomé : on se déplace dans l'image.
      setVue({ ...debut.current.vue, x: debut.current.vue.x + dx, y: debut.current.vue.y + dy });
    } else {
      // À l'échelle 1, le geste sert à changer d'image ou à fermer. On laisse
      // la direction dominante décider, sinon un glissement en diagonale fait
      // les deux à moitié.
      setGlisse(Math.abs(dx) > Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy });
    }
  }

  function lacher(e: React.PointerEvent) {
    doigts.current.delete(e.pointerId);
    if (doigts.current.size > 0) return;
    setEnGeste(false);

    const { x, y } = glisse;
    setGlisse({ x: 0, y: 0 });

    // Vers le bas, franchement : on ferme. Vers le haut, rien — remonter une
    // image pour la fermer n'est le geste de personne.
    if (y > SEUIL_FERMETURE) return fermer();
    if (Math.abs(x) > SEUIL_PAGE) return allerA(index + (x < 0 ? 1 : -1));

    // Un geste qui n'a rien déplacé est un toucher.
    if (Math.abs(x) < 8 && Math.abs(y) < 8 && vue.echelle === 1) {
      const maintenant = e.timeStamp;
      if (maintenant - dernierToucher.current < DELAI_DOUBLE) {
        dernierToucher.current = 0;
        aimer();
      } else {
        dernierToucher.current = maintenant;
        // On attend de savoir si un second toucher arrive avant de masquer
        // l'habillage : sinon il clignote à chaque double-tap.
        setTimeout(() => {
          if (dernierToucher.current === maintenant) setHabillage((h) => !h);
        }, DELAI_DOUBLE);
      }
    }
  }

  function aimer() {
    const entreeId = moi?.entreeDe(courant);
    if (!entreeId) return;
    setCoeur((c) => c + 1);
    void actionReagir(entreeId, "❤️");
  }

  /** Enregistrer ou envoyer ailleurs, par le partage du système. */
  async function partager() {
    try {
      const reponse = await fetch(courant.url);
      const blob = await reponse.blob();
      const nom = courant.genre === "video" ? "journee.mp4" : "journee.jpg";
      const fichier = new File([blob], nom, { type: blob.type });
      // `canShare` avant `share` : sur un navigateur qui partage du texte mais
      // pas des fichiers, `share` lèverait au lieu de refuser proprement.
      if (navigator.canShare?.({ files: [fichier] })) {
        await navigator.share({ files: [fichier] });
        return;
      }
      // Repli pour le bureau : un téléchargement. Sur iOS il ne mènerait à
      // rien — c'est la feuille de partage qui enregistre dans la pellicule.
      const url = URL.createObjectURL(blob);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = nom;
      lien.click();
      URL.revokeObjectURL(url);
    } catch {
      // Partage refusé ou annulé : il n'y a rien à dire.
    }
  }

  const voisines = [index - 1, index + 1].filter((i) => i >= 0 && i < photos.length);
  const opacite = Math.max(0.3, 1 - Math.abs(glisse.y) / 400);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ height: "100dvh", background: `rgb(0 0 0 / ${opacite})` }}
      role="dialog"
      aria-modal="true"
      aria-label={legende}
    >
      {/* Les voisines se chargent en avance : arriver sur un carré vide après
          avoir balayé, c'est ce qui fait qu'une galerie paraît lente. */}
      <div className="hidden">
        {voisines.map((i) => (
          <Image key={photos[i].id} src={photos[i].url} alt="" width={1} height={1} unoptimized priority />
        ))}
      </div>

      <div
        className={`flex justify-between zone-sure-haute transition-opacity ${habillage ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <button
          type="button"
          onClick={partager}
          aria-label="Enregistrer ou partager"
          className="m-2 grid h-11 w-11 place-items-center rounded-full text-white/80 transition hover:bg-white/10"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4M8 8l4-4 4 4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
        <button
          type="button"
          onClick={fermer}
          aria-label="Fermer"
          className="m-2 grid h-11 w-11 place-items-center rounded-full text-white/80 transition hover:bg-white/10"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div
        onPointerDown={prendre}
        onPointerMove={bouger}
        onPointerUp={lacher}
        onPointerCancel={lacher}
        // `touch-action: none` : sans ça, iOS prend le pincement pour lui et
        // zoome la page entière au lieu de l'image.
        className="relative flex flex-1 touch-none select-none items-center justify-center overflow-hidden px-2"
      >
        <div
          style={{
            transform: `translate(${vue.x + glisse.x}px, ${vue.y + glisse.y}px) scale(${vue.echelle})`,
            transition: enGeste ? "none" : "transform var(--duree-moyenne) var(--courbe-douce)",
          }}
          className="flex max-h-full items-center justify-center"
        >
          {courant.genre === "video" ? (
            <video
              key={courant.id}
              src={courant.url}
              poster={courant.vignette}
              controls
              loop
              playsInline
              autoPlay
              className="max-h-full w-auto max-w-full"
            />
          ) : (
            <Image
              key={courant.id}
              src={courant.url}
              alt={courant.legende ?? legende}
              width={courant.largeur || 1400}
              height={courant.hauteur || 1400}
              unoptimized
              priority
              draggable={false}
              className="max-h-full w-auto max-w-full object-contain"
            />
          )}
        </div>

        {coeur > 0 && (
          <span
            key={coeur}
            aria-hidden
            className="pointer-events-none absolute text-[96px]"
            style={{ animation: "coeur var(--duree-longue) var(--courbe-douce)" }}
          >
            ❤️
          </span>
        )}
      </div>

      <div
        className={`pb-4 text-center zone-sure-basse transition-opacity ${habillage ? "opacity-100" : "opacity-0"}`}
      >
        {courant.legende && (
          <p className="mx-auto max-w-md px-4 text-[14px] leading-snug text-white/90">
            {courant.legende}
          </p>
        )}
        {pied?.(courant) && <p className="mt-0.5 px-4 text-[12px] text-white/55">{pied(courant)}</p>}
        <p className="chiffres mt-1 text-[13px] text-white/60">
          {photos.length > 1 && `${index + 1} / ${photos.length}`}
          {courant.genre === "video" && courant.duree ? ` · ${enSecondes(courant.duree)}` : ""}
          {moi && " · touche deux fois pour aimer"}
        </p>
      </div>
    </div>
  );
}
