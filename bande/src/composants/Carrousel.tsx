"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import type { Photo } from "@/lib/types";

/**
 * Les photos d'une journée, qu'on parcourt au doigt.
 *
 * Le défilement est natif — `scroll-snap`, pas une animation maison. Un
 * carrousel qui réimplémente le geste se bagarre toujours avec celui du
 * système, et sur iOS il perd : l'inertie, le rebond et l'interruption au
 * toucher sont gratuits ici, et impossibles à imiter proprement.
 *
 * Au tap, la visionneuse plein écran s'ouvre.
 */
export function Carrousel({ photos, legende }: { photos: Photo[]; legende: string }) {
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
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setOuverte(index)}
              aria-label={`${legende} — photo ${index + 1} sur ${photos.length}, ouvrir en grand`}
              className="w-full shrink-0 snap-center"
            >
              <Image
                src={photo.url}
                alt={`${legende}, photo ${index + 1}`}
                width={photo.largeur}
                height={photo.hauteur}
                unoptimized
                className="h-auto w-full"
              />
            </button>
          ))}
        </div>

        {photos.length > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
            {photos.map((photo, index) => (
              <span
                key={photo.id}
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
 * Le plein écran.
 *
 * `100dvh` et non `100vh` : sur iOS, `vh` compte la barre d'adresse même
 * lorsqu'elle est rétractée, et l'image dépasserait sous le bord de l'écran.
 */
function Visionneuse({
  photos,
  depart,
  legende,
  fermer,
}: {
  photos: Photo[];
  depart: number;
  legende: string;
  fermer: () => void;
}) {
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
        ref={(e) => {
          // On se place sur la photo touchée, sans animation : l'utilisateur a
          // désigné celle-là, pas la première.
          if (e) e.scrollLeft = e.clientWidth * depart;
        }}
      >
        {photos.map((photo, index) => (
          <div key={photo.id} className="flex w-full shrink-0 snap-center items-center justify-center px-2">
            <Image
              src={photo.url}
              alt={`${legende}, photo ${index + 1}`}
              width={photo.largeur}
              height={photo.hauteur}
              unoptimized
              className="max-h-full w-auto max-w-full object-contain"
            />
          </div>
        ))}
      </div>

      {photos.length > 1 && (
        <p className="chiffres pb-4 text-center text-[13px] text-white/60 zone-sure-basse">
          {photos.length} photos
        </p>
      )}
    </div>
  );
}
