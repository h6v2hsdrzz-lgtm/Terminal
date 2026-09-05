"use client";

import Image from "next/image";
import { useState } from "react";

import { Visionneuse } from "./Carrousel";
import { enSecondes } from "@/lib/media";
import { enTexteLong } from "@/lib/dates";
import { couleurProfil } from "@/lib/couleurs";
import type { Media, Profil } from "@/lib/types";

export type MediaDate = Media & { jour: string; profil: string };

/**
 * Tout ce que la bande a posté, en mosaïque, groupé par mois.
 *
 * Une grille de vignettes carrées, et le plein écran par-dessus — celui du fil,
 * pas un second : deux visionneuses divergeraient au premier ajout.
 *
 * La grille ne sert que des vignettes. C'est ce qui la rend tenable : trois
 * cents médias en pleine résolution, ce sont trois cents méga-octets tirés pour
 * remplir des cases de cent pixels.
 */
export function Galerie({
  medias,
  profils,
}: {
  medias: MediaDate[];
  profils: Profil[];
}) {
  const [ouverte, setOuverte] = useState<number | null>(null);

  if (medias.length === 0) {
    return (
      <p className="text-[14px] leading-snug text-encre-2">
        Rien encore. La galerie se remplit toute seule : chaque photo et chaque
        vidéo posée sur une journée arrive ici.
      </p>
    );
  }

  // Groupés par mois, du plus récent au plus ancien. La liste arrive déjà
  // triée : on ne fait que la découper.
  const mois: { cle: string; medias: MediaDate[] }[] = [];
  for (const media of medias) {
    const cle = media.jour.slice(0, 7);
    const dernier = mois.at(-1);
    if (dernier && dernier.cle === cle) dernier.medias.push(media);
    else mois.push({ cle, medias: [media] });
  }

  const pseudo = (id: string) => profils.find((p) => p.id === id)?.pseudo ?? "quelqu'un";
  const teinte = (id: string) => {
    const profil = profils.find((p) => p.id === id);
    return profil ? couleurProfil(profil) : "var(--trait)";
  };

  return (
    <>
      <div className="space-y-6">
        {mois.map((groupe) => (
          <section key={groupe.cle}>
            <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
              {libelleMois(groupe.cle)}
            </h3>
            <ul className="grid grid-cols-3 gap-1.5">
              {groupe.medias.map((media) => (
                <li key={media.id}>
                  <button
                    type="button"
                    onClick={() => setOuverte(medias.indexOf(media))}
                    aria-label={`${media.genre === "video" ? "Vidéo" : "Photo"} de ${pseudo(media.profil)}, ${enTexteLong(media.jour)}${media.legende ? ` — ${media.legende}` : ""}`}
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

                    {/* Un liseré de la couleur de la personne : à trois, c'est
                        plus rapide à lire qu'un avatar dans chaque case. */}
                    <span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-[3px]"
                      style={{ background: teinte(media.profil) }}
                    />

                    {media.genre === "video" && (
                      <span
                        aria-hidden
                        className="absolute right-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                        style={{ background: "rgb(0 0 0 / 0.5)" }}
                      >
                        ▶ {media.duree ? enSecondes(media.duree) : ""}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {ouverte !== null && (
        <Visionneuse
          photos={medias}
          depart={ouverte}
          legende="La galerie de la bande"
          fermer={() => setOuverte(null)}
          pied={(media) => {
            const avec = medias.find((m) => m.id === media.id);
            return avec ? `${pseudo(avec.profil)} — ${enTexteLong(avec.jour)}` : null;
          }}
        />
      )}
    </>
  );
}

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** « septembre 2026 » — l'année comprise, parce qu'on remonte loin ici. */
function libelleMois(cle: string): string {
  const [annee, mois] = cle.split("-");
  return `${MOIS[Number(mois) - 1] ?? cle} ${annee}`;
}
