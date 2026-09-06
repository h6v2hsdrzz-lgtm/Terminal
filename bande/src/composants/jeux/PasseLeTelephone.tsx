"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Avatar } from "@/composants/Avatar";
import type { Joueur } from "@/lib/jeux/types";
import { RESSORT } from "@/lib/mouvement";

/**
 * Le vote secret, sur un seul téléphone.
 *
 * Sans écran de passage, celui qui vote le fait sous les yeux des deux autres,
 * et un vote simultané cesse d'être simultané. On intercale donc un écran
 * plein qui ne montre rien : « Passe le téléphone à Sam », Sam appuie, vote,
 * et l'écran redevient opaque avant de changer de main.
 *
 * C'est le prix du mode « un seul téléphone », et c'est un prix honnête : la
 * synchronisation entre trois appareils par sondage aurait deux secondes de
 * retard, ce qui se voit précisément sur un vote simultané.
 */
export function PasseLeTelephone({
  joueurs,
  question,
  rendre,
  surFin,
}: {
  joueurs: Joueur[];
  /** Ce qui est rappelé en haut pendant qu'on vote. */
  question: string;
  /** Le formulaire de vote d'un joueur ; il appelle `valider` quand c'est fait. */
  rendre: (joueur: Joueur, valider: (choix: string) => void) => React.ReactNode;
  /** Les choix, dans l'ordre des joueurs reçus. */
  surFin: (choix: Record<string, string>) => void;
}) {
  const [index, setIndex] = useState(0);
  const [cache, setCache] = useState(true);
  const [choix, setChoix] = useState<Record<string, string>>({});

  const joueur = joueurs[index];
  if (!joueur) return null;

  function valider(valeur: string) {
    const suivant = { ...choix, [joueur.membreId]: valeur };
    setChoix(suivant);
    if (index + 1 >= joueurs.length) {
      surFin(suivant);
      return;
    }
    setIndex(index + 1);
    setCache(true);
  }

  return (
    <div className="flex min-h-[62dvh] flex-col px-4 py-6">
      <AnimatePresence mode="wait">
        {cache ? (
          <motion.div
            key={`cache-${index}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={RESSORT.moyen}
            className="flex flex-1 flex-col items-center justify-center gap-5 text-center"
          >
            <Avatar
              profil={{
                id: joueur.membreId,
                pseudo: joueur.pseudo,
                teinte: joueur.teinte,
                initiales: joueur.initiales,
                avatar: joueur.avatar,
              }}
              taille={72}
            />
            <p className="text-[22px] font-semibold tracking-tight">
              Passe le téléphone à {joueur.pseudo}
            </p>
            <p className="max-w-[26ch] text-[15px] text-encre-2">
              Les deux autres ne regardent pas. C&apos;est tout l&apos;intérêt.
            </p>
            <button
              type="button"
              onClick={() => setCache(false)}
              className="cible-tactile mt-2 rounded-[var(--radius-pilule)] bg-encre px-6 py-3 text-[16px] font-semibold text-surface"
            >
              C&apos;est moi
            </button>
          </motion.div>
        ) : (
          <motion.div
            key={`vote-${index}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={RESSORT.moyen}
            className="flex flex-1 flex-col justify-center"
          >
            <p className="mb-4 text-[15px] leading-snug text-encre-2">{question}</p>
            {rendre(joueur, valider)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
