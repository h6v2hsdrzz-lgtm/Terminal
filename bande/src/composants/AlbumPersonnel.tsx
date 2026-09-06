"use client";

import Image from "next/image";
import { useState } from "react";

import { Visionneuse } from "./Carrousel";
import { enSecondes } from "@/lib/media";
import type { Media } from "@/lib/types";

/**
 * Les dix derniers médias d'une personne, en grille.
 *
 * Les vignettes, jamais les originaux : dix images de mille quatre cents
 * pixels pour dix cases de cent, ce serait dix méga-octets tirés pour rien.
 * Le plein écran est celui du fil — deux visionneuses divergeraient au premier
 * ajout.
 */
export function AlbumPersonnel({ medias }: { medias: Media[] }) {
  const [ouverte, setOuverte] = useState<number | null>(null);
  if (medias.length === 0) return null;

  return (
    <>
      <ul className="grid grid-cols-5 gap-1.5">
        {medias.map((media, index) => (
          <li key={media.id}>
            <button
              type="button"
              onClick={() => setOuverte(index)}
              aria-label={`${media.genre === "video" ? "Vidéo" : "Photo"}${media.legende ? ` — ${media.legende}` : ""}, ouvrir en grand`}
              className="relative block w-full overflow-hidden rounded-lg"
            >
              <Image
                src={media.vignette}
                alt=""
                width={400}
                height={400}
                unoptimized
                className="aspect-square w-full object-cover"
              />
              {media.genre === "video" && (
                <span
                  aria-hidden
                  className="absolute right-0.5 top-0.5 rounded-full px-1 text-[10px] text-white"
                  style={{ background: "rgb(0 0 0 / 0.5)" }}
                >
                  ▶ {media.duree ? enSecondes(media.duree) : ""}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {ouverte !== null && (
        <Visionneuse
          photos={medias}
          depart={ouverte}
          legende="Ton album"
          fermer={() => setOuverte(null)}
        />
      )}
    </>
  );
}
