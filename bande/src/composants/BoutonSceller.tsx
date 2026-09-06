"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { FormulaireScelle, GENRES } from "./Scelles";
import type { GenreScelle } from "@/lib/depot";
import { RESSORT } from "@/lib/mouvement";

/**
 * Le bouton « Sceller quelque chose ».
 *
 * C'est le geste signature de l'application, et jusqu'ici c'était un lien
 * souligné de treize pixels au bas d'une carte, qui envoyait sur une autre
 * page. Il devient un vrai bouton pleine largeur, et il ouvre une feuille sur
 * place : quitter l'écran pour sceller, c'est perdre ce qu'on était en train
 * d'écrire.
 *
 * **Le sable coule très lentement**, un cycle de trois secondes. C'est le seul
 * endroit de l'écran où l'on s'autorise un peu plus que le reste — mais une
 * animation rapide sur un écran de journal devient un clignotement au bout de
 * la deuxième journée, et on finit par ne plus regarder l'objet du tout.
 */
export function BoutonSceller({ aujourdhui }: { aujourdhui: string }) {
  const [feuille, setFeuille] = useState(false);
  const [genre, setGenre] = useState<GenreScelle | null>(null);

  function fermer() {
    setFeuille(false);
    setGenre(null);
  }

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setFeuille(true)}
        whileTap={{ scale: 0.98 }}
        transition={RESSORT.vif}
        className="cible-tactile mt-3 flex w-full items-center justify-center gap-2.5 rounded-[var(--radius-carte)] border border-trait px-4 py-3.5 text-[15px] font-semibold"
        style={{
          // Un dégradé à peine perceptible : il donne du relief au seul bouton
          // de l'écran qui en mérite, sans introduire une couleur que le reste
          // de l'application n'utilise nulle part.
          backgroundImage:
            "linear-gradient(160deg, var(--surface-2) 0%, var(--surface-3) 100%)",
        }}
      >
        <Sablier />
        Sceller quelque chose
      </motion.button>

      <AnimatePresence>
        {feuille && (
          <>
            <motion.button
              type="button"
              aria-label="Fermer"
              onClick={fermer}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              // Un noir franc plutôt qu'un jeton de la palette : le voile de
              // l'application est presque transparent, fait pour une barre
              // d'onglets. Une feuille modale doit éteindre ce qu'il y a
              // derrière, sinon on continue de lire la page au lieu de choisir.
              style={{ background: "rgb(0 0 0 / .45)" }}
              className="fixed inset-0 z-40"
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Sceller quelque chose"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={RESSORT.ample}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[24px] border-t border-trait bg-surface px-4 pb-8 pt-3 zone-sure-basse"
            >
              <div aria-hidden className="mx-auto mb-4 h-1 w-10 rounded-full bg-surface-3" />

              {genre === null ? (
                <>
                  <p className="text-[19px] font-semibold tracking-tight">
                    Sceller quelque chose
                  </p>
                  <p className="mt-1 text-[14px] leading-snug text-encre-2">
                    Fermé jusqu&apos;à une date que tu choisis, et qui s&apos;ouvre
                    devant tout le monde ce jour-là.
                  </p>
                  <ul className="mt-4 space-y-2">
                    {GENRES.map((g) => (
                      <li key={g.cle}>
                        <button
                          type="button"
                          onClick={() => setGenre(g.cle)}
                          className="cible-tactile w-full rounded-[var(--radius-carte)] border border-trait px-4 py-3 text-left"
                        >
                          <span className="block text-[16px] font-semibold">{g.nom}</span>
                          <span className="block text-[13px] text-encre-3">{g.aide}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={fermer}
                    className="cible-tactile mt-4 w-full py-2.5 text-[14px] text-encre-3"
                  >
                    Pas maintenant
                  </button>
                </>
              ) : (
                <FormulaireScelle
                  aujourdhui={aujourdhui}
                  genreInitial={genre}
                  fermer={fermer}
                />
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Le sablier, dont le sable descend en boucle.
 *
 * Trois formes animées, pas un GIF : le grain du haut se vide, celui du bas se
 * remplit, et un filet les relie. Trois secondes par cycle, et un cycle
 * complet plutôt qu'un aller-retour — un sablier qui se retourne tout seul
 * n'existe pas.
 */
function Sablier() {
  const cycle = { duration: 3, repeat: Infinity, ease: "linear" as const };
  return (
    <svg width="17" height="20" viewBox="0 0 17 20" aria-hidden>
      <path
        d="M3 1.5h11M3 18.5h11M4 1.5c0 4 4.5 5.5 4.5 8.5S4 14.5 4 18.5M13 1.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* Le sable du haut : un coin qui se vide. */}
      <motion.path
        d="M5.2 3.2h6.6c-.2 2.6-3.3 4.2-3.3 4.2S5.4 5.8 5.2 3.2Z"
        fill="currentColor"
        animate={{ opacity: [1, 1, 0.15, 0.15], scaleY: [1, 0.35, 0, 0] }}
        style={{ transformOrigin: "8.5px 3.2px" }}
        transition={cycle}
      />
      {/* Le filet qui coule, visible seulement au milieu du cycle. */}
      <motion.rect
        x="8.1"
        y="8"
        width="0.8"
        height="4"
        fill="currentColor"
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={cycle}
      />
      {/* Le sable du bas : un tas qui monte. */}
      <motion.path
        d="M5.2 16.8h6.6c-.2-2.6-3.3-4.2-3.3-4.2s-3.1 1.6-3.3 4.2Z"
        fill="currentColor"
        animate={{ opacity: [0.15, 0.6, 1, 1], scaleY: [0, 0.6, 1, 1] }}
        style={{ transformOrigin: "8.5px 16.8px" }}
        transition={cycle}
      />
    </svg>
  );
}
