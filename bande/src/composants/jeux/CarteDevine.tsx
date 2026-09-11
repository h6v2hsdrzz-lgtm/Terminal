"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";

import { RESSORT } from "@/lib/mouvement";

/**
 * L'image d'une carte de « Devine qui je suis », et ce qu'on pose dessus.
 *
 * ## La contrainte, et elle décide de tout
 *
 * Cet écran se lit **à deux mètres**, par deux personnes qui rigolent, dans un
 * salon mal éclairé. Le nom reste donc énorme et toujours présent — l'image ne
 * le remplace pas, elle l'accompagne : une photo de Ribéry sans son nom se
 * devine mal, et une photo ratée ne doit jamais coûter la manche.
 *
 * ## Pourquoi l'image arrive en deux temps
 *
 * On demande d'abord ce qu'on sait de la carte (y a-t-il une image, quelle
 * forme, à qui la créditer), puis l'image elle-même. C'est un aller-retour de
 * plus, et il évite deux choses : embarquer cinq cents adresses dans le paquet
 * du navigateur pour en lire une, et faire clignoter une image cassée sur les
 * cartes qui n'en ont pas — « Un carton rouge » n'a pas de portrait, et n'en a
 * pas besoin.
 *
 * ## Pourquoi les enfants sont une fonction
 *
 * Ce qu'on pose sur la carte doit savoir s'il est sur une photo ou sur le fond
 * de l'application : du texte en couleur d'encre, parfaitement lisible en temps
 * normal, disparaît sur un ciel clair. Le contenu reçoit donc `surImage`, et
 * choisit ses couleurs.
 */
type Infos = { largeur: number; hauteur: number; auteur: string; licence: string };

export function FondDeCarte({
  carte,
  enfants,
}: {
  carte: string;
  enfants: (surImage: boolean) => ReactNode;
}) {
  const [infos, setInfos] = useState<Infos | null>(null);
  const [chargee, setChargee] = useState(false);
  const [carteVue, setCarteVue] = useState(carte);

  // La carte a changé : on repart de zéro **pendant le rendu**, pas dans un
  // effet. Remettre l'état à zéro dans un effet laisserait l'ancienne image à
  // l'écran le temps d'un rendu — on verrait Zidane sous le nom de Ribéry — et
  // la règle `react-hooks/set-state-in-effect` le refuse, à juste titre.
  if (carte !== carteVue) {
    setCarteVue(carte);
    setInfos(null);
    setChargee(false);
  }

  useEffect(() => {
    let vivant = true;
    void fetch(`/api/carte/${encodeURIComponent(carte)}/infos`)
      .then((r) => (r.ok ? (r.json() as Promise<Infos>) : null))
      .then((recu) => {
        if (vivant && recu) setInfos(recu);
      })
      .catch(() => {
        // Pas d'image : la carte se joue en texte, comme avant. Ce n'est pas une
        // erreur à montrer, c'est le cas normal pour une carte sur trois.
      });
    return () => {
      vivant = false;
    };
  }, [carte]);

  if (!infos) {
    return <>{enfants(false)}</>;
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* L'image remplit le cadre et se fait recadrer : un portrait vertical et
          une affiche horizontale doivent occuper la même place, sinon le nom
          saute d'une carte à l'autre. */}
      <motion.img
        key={carte}
        src={`/api/carte/${encodeURIComponent(carte)}`}
        alt=""
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: chargee ? 1 : 0, scale: 1 }}
        transition={RESSORT.moyen}
        onLoad={() => setChargee(true)}
        onError={() => setInfos(null)}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Le dégradé : sans lui, un nom blanc sur un ciel blanc ne se lit pas. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.70) 34%, rgba(0,0,0,0.12) 70%, rgba(0,0,0,0.30) 100%)",
        }}
      />

      {enfants(true)}

      <p
        className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-2 text-[11px]"
        style={{ color: "rgba(255,255,255,0.62)" }}
      >
        {[infos.auteur, infos.licence, "Wikimedia Commons"].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

/** La carte telle que la voient ceux qui font deviner : l'image, et le nom. */
export function CarteDevine({ carte }: { carte: string }) {
  return (
    <div className="relative min-h-[70dvh] w-full overflow-hidden">
      <FondDeCarte
        carte={carte}
        enfants={(surImage) =>
          surImage ? (
            <p
              className="absolute inset-x-0 bottom-0 px-5 pb-8 text-[48px] font-semibold leading-[1.02] tracking-[-0.03em]"
              style={{ color: "#fff", textShadow: "0 2px 18px rgba(0,0,0,0.55)" }}
            >
              {carte}
            </p>
          ) : (
            <div className="flex min-h-[70dvh] flex-col items-center justify-center px-4">
              <motion.p
                key={carte}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={RESSORT.moyen}
                className="text-center text-[44px] font-semibold leading-[1.05] tracking-[-0.03em]"
              >
                {carte}
              </motion.p>
            </div>
          )
        }
      />
    </div>
  );
}
