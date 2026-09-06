"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { enSecondes } from "@/lib/media";
import { Visionneuse } from "./Visionneuse";
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
export function Carrousel({
  photos,
  legende,
  entreeId,
}: {
  photos: Media[];
  legende: string;
  /** Donné, le double-tap en plein écran pose un cœur sur cette journée. */
  entreeId?: string;
}) {
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
          moi={entreeId ? { entreeDe: () => entreeId } : undefined}
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
