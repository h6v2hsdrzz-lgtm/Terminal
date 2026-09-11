"use client";

import { useEffect, useState } from "react";

import { versLocal } from "@/lib/jeux/salon";

import type { MoteurMulti } from "./CoquilleMulti";
import { PHASES, classementDeVitesse, reponsesDe } from "./protocole";

/**
 * « Le plus rapide », et le seul jeu où la latence changerait le vainqueur.
 *
 * ## Le problème
 *
 * Si le serveur criait « maintenant ! », celui dont le réseau répond en 40 ms
 * gagnerait toujours contre celui qui est à 200 ms. Ce ne serait pas un jeu de
 * réflexe, ce serait un classement d'opérateurs.
 *
 * ## Ce qu'on fait
 *
 * Le serveur annonce **à l'avance** un instant absolu. Chaque téléphone le
 * ramène à sa propre horloge — d'où le décalage mesuré à chaque état reçu — et
 * le compte à rebours tourne **en local**. Le réseau n'entre plus dans le
 * geste ; il ne sert qu'à rapporter le résultat, et c'est l'horodatage du
 * serveur qui départage.
 *
 * Celui qui appuie avant le vert a brûlé le départ : il boit, et il ne peut
 * plus gagner la manche. Sans ça, la stratégie gagnante serait de marteler
 * l'écran.
 */
export function EcranReflexe({ moteur }: { moteur: MoteurMulti }) {
  const { etat, joueurs, moi, decalage } = moteur;
  // Une horloge locale qui bat pendant l'attente, plutôt qu'un état qu'on
  // bascule : `vert` se DÉDUIT du temps, il ne se décrète pas. C'est ce qui
  // rend le passage au vert juste même si le composant se remonte au milieu du
  // compte à rebours — un flux qui se reconnecte, par exemple.
  const [maintenant, setMaintenant] = useState(() => Date.now());

  const brut = etat.donneesPhase.departA;
  const departA = typeof brut === "string" ? versLocal(brut, decalage) : null;
  const revelation = etat.phase === PHASES.revelation;
  const reponses = reponsesDe(
    etat,
    revelation ? PHASES.depart : (etat.phase ?? ""),
  );
  const maReponse = reponses.find((r) => r.membreId === moi);

  const vert = departA !== null && maintenant >= departA;

  useEffect(() => {
    if (departA === null || vert) return;
    // Cinquante millisecondes : en dessous on rend pour rien, au-dessus le
    // passage au vert se voit arriver en retard sur un jeu qui se mesure en
    // centièmes.
    const battement = setInterval(() => setMaintenant(Date.now()), 50);
    return () => clearInterval(battement);
  }, [departA, vert]);

  if (revelation) {
    return (
      <div className="flex min-h-[70dvh] flex-col justify-between px-4 py-6">
        <div>
          <p className="text-[24px] font-semibold leading-tight">
            {String(etat.donneesPhase.verdict ?? "")}
          </p>
          <ul className="mt-5 space-y-1.5">
            {classementDeVitesse(reponses).map(({ reponse, rang }) => {
              const joueur = joueurs.find((j) => j.membreId === reponse.membreId);
              const brule = reponse.donnees.faux === true;
              return (
                <li
                  key={reponse.membreId}
                  className="flex items-baseline justify-between gap-3 text-[15px]"
                >
                  <span>
                    {brule ? "🔥 " : `${rang}. `}
                    {joueur?.pseudo ?? "quelqu'un"}
                  </span>
                  <span className="chiffres text-[13px] text-encre-3">
                    {brule ? "trop tôt" : "à l'heure"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {moteur.jeSuisHote ? (
          <button
            type="button"
            onClick={moteur.suivante}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="w-full rounded-[var(--radius-pilule)] px-4 py-3.5 text-[16px] font-semibold"
          >
            On remet ça
          </button>
        ) : (
          <p className="text-center text-[13px] text-encre-3">
            L&apos;hôte enchaîne.
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={maReponse !== undefined}
      onClick={() => moteur.repondre(vert ? {} : { faux: true })}
      // La zone entière est le bouton : viser une cible avec le pouce
      // ajouterait au temps de réaction ce que le jeu essaie de mesurer.
      className="flex min-h-[70dvh] w-full flex-col items-center justify-center gap-3 px-4 transition-colors"
      style={{
        background: vert ? "var(--joie-9)" : "var(--surface-2)",
      }}
    >
      <span className="text-[28px] font-semibold tracking-[-0.02em]">
        {maReponse
          ? maReponse.donnees.faux === true
            ? "Trop tôt."
            : "Enregistré."
          : vert
            ? "MAINTENANT"
            : "Attends…"}
      </span>
      <span className="text-[14px] text-encre-2">
        {maReponse
          ? `${reponses.length} sur ${etat.presents.length} ont appuyé.`
          : vert
            ? "Appuie n'importe où."
            : "Appuyer avant le vert fait boire."}
      </span>
    </button>
  );
}
