"use client";

import { CoquilleJeu } from "./CoquilleJeu";
import { JeuDevineQui } from "./JeuDevineQui";
import { JeuJamais } from "./JeuJamais";
import type { CarteMaison, Partie } from "@/lib/jeux/types";
import type { Jeu } from "@/lib/jeux/catalogue";

/**
 * L'aiguillage : quelle partie, quel jeu.
 *
 * Un `switch` sur la clé plutôt qu'un registre d'objets : dix entrées se lisent
 * d'un coup d'œil, et un import dynamique par jeu coûterait un aller-retour
 * réseau au lancement — précisément au moment où trois personnes attendent.
 */
export function JeuEnCours({
  partie,
  jeu,
  cartesMaison,
}: {
  partie: Partie;
  jeu: Jeu;
  cartesMaison: CarteMaison[];
}) {
  return (
    <CoquilleJeu partie={partie} jeu={jeu}>
      {(moteur) => {
        switch (jeu.cle) {
          case "devine-qui":
            return <JeuDevineQui moteur={moteur} cartesMaison={cartesMaison} />;
          case "jamais":
            return <JeuJamais moteur={moteur} />;
          default:
            return (
              <p className="px-4 py-10 text-center text-[15px] text-encre-2">
                Ce jeu n&apos;est pas encore branché.
              </p>
            );
        }
      }}
    </CoquilleJeu>
  );
}
