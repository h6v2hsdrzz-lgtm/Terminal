"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { enSecondes } from "@/lib/media";
import type { Media } from "@/lib/types";

/**
 * Les médias d'une journée, qu'on parcourt au doigt.
 *
 * Le défilement est natif — `scroll-snap`, pas une animation maison. Un
 * carrousel qui réimplémente le geste se bagarre toujours avec celui du
 * système, et sur iOS il perd : l'inertie, le rebond et l'interruption au
 * toucher sont gratuits ici, et impossibles à imiter proprement.
 *
 * Au tap, la visionneuse plein écran s'ouvre.
 */
export function Carrousel({ photos, legende }: { photos: Media[]; legende: string }) {
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const piste = useRef<HTMLDivElement>(null);

  if (photos.length === 0) return null;

  return (
    <>
      <div className="relative border-t border-trait">
        <div
          ref={piste}
          onScroll={(e) => {
            const largeur = e.currentTarget.clientWidth || 1;
            setActive(Math.round(e.currentTarget.scrollLeft / largeur));
          }}
          className="flex snap-x snap-mandatory overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {photos.map((media, index) => (
            <button
              key={media.id}
              type="button"
              onClick={() => setOuverte(index)}
              aria-label={`${legende} — ${media.genre === "video" ? "vidéo" : "photo"} ${index + 1} sur ${photos.length}, ouvrir en grand`}
              className="relative w-full shrink-0 snap-center"
            >
              {media.genre === "video" ? (
                <ApercuVideo media={media} actif={index === active} />
              ) : (
                <Image
                  src={media.vignette}
                  alt={media.legende ?? `${legende}, photo ${index + 1}`}
                  width={media.largeur}
                  height={media.hauteur}
                  unoptimized
                  className="h-auto w-full"
                />
              )}

              {media.legende && (
                <p
                  className="absolute inset-x-0 bottom-0 px-3 py-2 text-left text-[13px] leading-snug text-white"
                  style={{ background: "linear-gradient(transparent, rgb(0 0 0 / 0.55))" }}
                >
                  {media.legende}
                </p>
              )}
            </button>
          ))}
        </div>

        {photos.length > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {photos.map((media, index) => (
              <span
                key={media.id}
                className="h-1.5 w-1.5 rounded-full transition"
                style={{
                  background: "white",
                  opacity: index === active ? 0.95 : 0.45,
                  boxShadow: "0 0 3px rgb(0 0 0 / .4)",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {ouverte !== null && (
        <Visionneuse
          photos={photos}
          depart={ouverte}
          legende={legende}
          fermer={() => setOuverte(null)}
        />
      )}
    </>
  );
}

/**
 * Une vidéo dans le fil : muette, en boucle, et seulement quand on la regarde.
 *
 * Trois conditions, et aucune n'est décorative :
 *
 * · **muette** — c'est la seule façon de lire sans geste sur iOS, et un fil qui
 *   parle tout seul quand on le fait défiler est insupportable ;
 * · **en boucle** — huit secondes, ça se lit comme une image animée ;
 * · **seulement la vidéo visible** — sans ça, six vidéos se téléchargent et
 *   décodent en même temps, et le téléphone chauffe. On s'appuie sur
 *   `IntersectionObserver` en plus de la position dans le carrousel : une carte
 *   sortie de l'écran ne doit pas continuer à jouer.
 */
function ApercuVideo({ media, actif }: { media: Media; actif: boolean }) {
  const element = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const video = element.current;
    if (!video) return;
    const guetteur = new IntersectionObserver(
      ([entree]) => setVisible(entree.isIntersecting),
      { threshold: 0.5 },
    );
    guetteur.observe(video);
    return () => guetteur.disconnect();
  }, []);

  useEffect(() => {
    const video = element.current;
    if (!video) return;
    if (actif && visible) {
      // La lecture peut être refusée malgré `muted` (économiseur de batterie) :
      // on laisse l'affiche à l'écran plutôt que de laisser la promesse traîner.
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [actif, visible]);

  return (
    <div className="relative">
      <video
        ref={element}
        src={media.url}
        poster={media.vignette}
        muted
        loop
        playsInline
        // `metadata` et non `auto` : sans ça, les six vidéos d'une journée se
        // téléchargent entièrement dès que la carte apparaît.
        preload="metadata"
        className="h-auto w-full"
      />
      <span
        className="pointer-events-none absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-white"
        style={{ background: "rgb(0 0 0 / 0.5)" }}
      >
        {media.duree ? enSecondes(media.duree) : "vidéo"}
      </span>
    </div>
  );
}

/**
 * Le plein écran.
 *
 * `100dvh` et non `100vh` : sur iOS, `vh` compte la barre d'adresse même
 * lorsqu'elle est rétractée, et l'image dépasserait sous le bord de l'écran.
 *
 * C'est ici, et seulement ici, qu'une vidéo a le son : on l'a ouverte exprès.
 */
export function Visionneuse({
  photos,
  depart,
  legende,
  fermer,
  pied,
}: {
  photos: Media[];
  depart: number;
  legende: string;
  fermer: () => void;
  /** De quoi situer le média courant — la galerie y met le jour et l'auteur. */
  pied?: (media: Media) => string | null;
}) {
  const [active, setActive] = useState(depart);

  // Échap ferme, comme partout ailleurs — et sur grand écran c'est le réflexe.
  useEffect(() => {
    const touche = (e: KeyboardEvent) => e.key === "Escape" && fermer();
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [fermer]);

  const courant = photos[active];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      style={{ height: "100dvh" }}
      role="dialog"
      aria-modal="true"
      aria-label={legende}
    >
      <div className="flex justify-end zone-sure-haute">
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
        className="flex flex-1 snap-x snap-mandatory items-center overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
        onScroll={(e) => {
          const largeur = e.currentTarget.clientWidth || 1;
          setActive(Math.round(e.currentTarget.scrollLeft / largeur));
        }}
        ref={(e) => {
          // On se place sur le média touché, sans animation : l'utilisateur a
          // désigné celui-là, pas le premier.
          if (e) e.scrollLeft = e.clientWidth * depart;
        }}
      >
        {photos.map((media, index) => (
          <div key={media.id} className="flex w-full shrink-0 snap-center items-center justify-center px-2">
            {media.genre === "video" ? (
              <video
                src={media.url}
                poster={media.vignette}
                controls
                loop
                playsInline
                // Seule la vidéo affichée charge : les autres attendent qu'on
                // arrive dessus.
                preload={index === active ? "auto" : "none"}
                autoPlay={index === active}
                className="max-h-full w-auto max-w-full"
              />
            ) : (
              <Image
                src={media.url}
                alt={media.legende ?? `${legende}, photo ${index + 1}`}
                width={media.largeur}
                height={media.hauteur}
                unoptimized
                className="max-h-full w-auto max-w-full object-contain"
              />
            )}
          </div>
        ))}
      </div>

      <div className="pb-4 text-center zone-sure-basse">
        {courant?.legende && (
          <p className="mx-auto max-w-md px-4 text-[14px] leading-snug text-white/90">
            {courant.legende}
          </p>
        )}
        {courant && pied?.(courant) && (
          <p className="mt-0.5 px-4 text-[12px] text-white/55">{pied(courant)}</p>
        )}
        {photos.length > 1 && (
          <p className="chiffres mt-1 text-[13px] text-white/60">
            {active + 1} / {photos.length}
          </p>
        )}
      </div>
    </div>
  );
}
