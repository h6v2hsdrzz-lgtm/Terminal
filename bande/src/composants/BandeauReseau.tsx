"use client";

import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";

import {
  lireReseau,
  lireReseauServeur,
  oublierPanne,
  sAbonnerReseau,
} from "@/lib/reseau";

/**
 * Le seul endroit où l'application dit que quelque chose ne va pas.
 *
 * Trois états, et ils ne se valent pas :
 *
 * · **hors ligne** — ce n'est pas une erreur, c'est un tunnel. Ton ne pas être
 *   alarmant, et on continue d'essayer tout seul ;
 * · **de retour** — trois secondes, puis ça disparaît. Ne rien dire laisserait
 *   croire que c'est toujours coupé ;
 * · **une panne** — quelque chose n'est PAS passé. Là il faut un bouton, parce
 *   que la personne a fait un geste et que ce geste n'a rien donné.
 *
 * Il est seul dans la disposition du repaire, et les appelants lui parlent par
 * `src/lib/reseau.ts`. Un bandeau par composant aurait donné trois bandeaux
 * empilés au premier tunnel.
 */
export function BandeauReseau() {
  const reseau = useSyncExternalStore(sAbonnerReseau, lireReseau, lireReseauServeur);

  // Une panne passe devant : elle porte un geste qui a échoué, l'absence de
  // réseau n'en porte aucun.
  const quoi = reseau.panne ? "panne" : reseau.horsLigne ? "coupe" : reseau.deRetour ? "retour" : null;

  return (
    <AnimatePresence>
      {quoi && (
        <motion.div
          key={quoi}
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          // `zone-sure-haute` n'irait pas : ce bandeau se pose PAR-DESSUS
          // l'encoche, comme le fait le système lui-même.
          className="fixed inset-x-0 top-0 z-50 px-3 pt-[env(safe-area-inset-top)]"
        >
          <div
            role={quoi === "panne" ? "alert" : "status"}
            className="mt-1.5 flex items-center gap-3 rounded-[var(--radius-carte)] px-3.5 py-2.5 text-[13px] leading-snug shadow-[0_8px_24px_rgb(0_0_0/.18)]"
            style={
              quoi === "retour"
                ? { background: "var(--profil-2)", color: "var(--surface)" }
                : { background: "var(--encre)", color: "var(--surface)" }
            }
          >
            {quoi === "coupe" && (
              <span className="flex-1">
                Hors ligne. Ce que tu écris est gardé sur ce téléphone et partira tout
                seul.
              </span>
            )}
            {quoi === "retour" && <span className="flex-1 font-medium">De retour en ligne.</span>}
            {quoi === "panne" && (
              <>
                <span className="flex-1">{reseau.panne?.message}</span>
                {reseau.panne?.reessayer && (
                  <button
                    type="button"
                    onClick={reseau.panne.reessayer}
                    className="shrink-0 rounded-[var(--radius-pilule)] px-3 py-1.5 text-[13px] font-semibold"
                    style={{ background: "var(--surface)", color: "var(--encre)" }}
                  >
                    Réessayer
                  </button>
                )}
                <button
                  type="button"
                  onClick={oublierPanne}
                  aria-label="Fermer"
                  className="shrink-0 px-1 text-[16px] opacity-70"
                >
                  ×
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
