"use client";

import { CoquilleJeu } from "./CoquilleJeu";
import { JeuDevineQui } from "./JeuDevineQui";
import { JeuJamais } from "./JeuJamais";
import { JeuJugement } from "./JeuJugement";
import { JeuMenteur } from "./JeuMenteur";
import { JeuPlusRapide } from "./JeuPlusRapide";
import { JeuPrefere } from "./JeuPrefere";
import { JeuQuiAEcrit } from "./JeuQuiAEcrit";
import { JeuQuiz } from "./JeuQuiz";
import { JeuSusceptible } from "./JeuSusceptible";
import { JeuTop3 } from "./JeuTop3";
import type { CarteMaison, Partie } from "@/lib/jeux/types";
import type { Jeu } from "@/lib/jeux/catalogue";
import type { Entree, Profil } from "@/lib/types";

/**
 * L'aiguillage : quelle partie, quel jeu.
 *
 * Un `switch` sur la clé plutôt qu'un registre d'objets : dix entrées se lisent
 * d'un coup d'œil, et un import dynamique par jeu coûterait un aller-retour
 * réseau au lancement — précisément au moment où trois personnes attendent.
 *
 * Les journées et les profils ne servent qu'aux deux jeux qui se nourrissent du
 * journal ; ils sont chargés par la page serveur, une fois, plutôt que
 * demandés par chaque jeu au moment de sa première manche.
 */
export function JeuEnCours({
  partie,
  jeu,
  cartesMaison,
  entrees,
  profils,
}: {
  partie: Partie;
  jeu: Jeu;
  cartesMaison: CarteMaison[];
  entrees: Entree[];
  profils: Profil[];
}) {
  return (
    <CoquilleJeu partie={partie} jeu={jeu}>
      {(moteur) => {
        switch (jeu.cle) {
          case "devine-qui":
            return <JeuDevineQui moteur={moteur} cartesMaison={cartesMaison} />;
          case "jamais":
            return <JeuJamais moteur={moteur} />;
          case "prefere":
            return <JeuPrefere moteur={moteur} />;
          case "susceptible":
            return <JeuSusceptible moteur={moteur} />;
          case "jugement":
            return <JeuJugement moteur={moteur} />;
          case "menteur":
            return <JeuMenteur moteur={moteur} />;
          case "top3":
            return <JeuTop3 moteur={moteur} />;
          case "plus-rapide":
            return <JeuPlusRapide moteur={moteur} />;
          case "quiz-bande":
            return <JeuQuiz moteur={moteur} entrees={entrees} profils={profils} />;
          case "qui-a-ecrit":
            return <JeuQuiAEcrit moteur={moteur} entrees={entrees} />;
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
