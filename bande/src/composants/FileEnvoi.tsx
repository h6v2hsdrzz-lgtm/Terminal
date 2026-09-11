"use client";

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";

import { abandonner, instantane, instantaneServeur, reessayer, sAbonner } from "@/lib/file-envoi";
import { RESSORT } from "@/lib/mouvement";

/**
 * Ce qui monte, et ce qui a coincé.
 *
 * Discret par construction : une seule ligne tant que tout va bien, et elle
 * disparaît dès que la file est vide. Elle ne devient un objet à toucher que
 * lorsqu'un envoi a vraiment échoué — c'est le seul moment où l'on a quelque
 * chose à décider.
 *
 * L'état vient du module, pas d'un composant parent : c'est ce qui permet de
 * changer d'écran pendant qu'une vidéo monte.
 */
export function FileEnvoi() {
  const file = useSyncExternalStore(sAbonner, instantane, instantaneServeur);
  if (file.length === 0) return null;

  const echecs = file.filter((e) => e.etat === "echec");
  const enCours = file.length - echecs.length;

  return (
    <div className="mt-3 space-y-2">
      <AnimatePresence initial={false}>
        {enCours > 0 && (
          <motion.p
            key="en-cours"
            role="status"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={RESSORT.vif}
            className="flex items-center gap-2 text-[13px] text-encre-3"
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-encre-3"
            />
            {enCours === 1
              ? file.some((e) => e.etat === "reprise")
                ? "Le réseau a lâché. On réessaie."
                : "Envoi en cours… tu peux continuer à écrire."
              : `${enCours} envois en cours… tu peux continuer à écrire.`}
          </motion.p>
        )}

        {echecs.map((envoi) => (
          <motion.div
            key={envoi.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={RESSORT.vif}
            className="flex items-center gap-2 rounded-2xl border border-trait bg-surface-2 px-3 py-2"
          >
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-encre-2">
              {envoi.erreur ?? "Cet envoi n'est pas passé."}
            </p>
            <button
              type="button"
              onClick={() => reessayer(envoi.id)}
              className="cible-tactile shrink-0 px-2 py-1 text-[13px] font-medium underline underline-offset-2"
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={() => abandonner(envoi.id)}
              aria-label="Abandonner cet envoi"
              className="cible-tactile shrink-0 px-2 py-1 text-[13px] text-encre-3"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
