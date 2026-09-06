"use client";

import { motion } from "motion/react";

import { Avatar } from "@/composants/Avatar";
import { RESSORT } from "@/lib/mouvement";
import type { Joueur } from "@/lib/depot-jeux";

/**
 * Le classement pendant la partie : une barre fine, permanente, jamais
 * envahissante — c'est le mot du plan, et c'est la bonne contrainte.
 *
 * Elle ne se réordonne pas. Voir les avatars sauter de place à chaque point
 * transforme une barre d'information en événement, et on finit par regarder la
 * barre au lieu de jouer. L'ordre est celui du tirage, il ne bouge plus ; seuls
 * les chiffres changent, et le meneur est signalé par un point.
 */
export function BarreScore({ joueurs, tourDe }: { joueurs: Joueur[]; tourDe?: string | null }) {
  const meilleur = Math.max(0, ...joueurs.map((j) => j.points));

  return (
    <div className="flex items-center justify-center gap-4 border-b border-trait bg-surface px-4 py-2">
      {joueurs.map((joueur) => {
        const mene = joueur.points === meilleur && meilleur > 0;
        return (
          <div key={joueur.membreId} className="flex items-center gap-1.5">
            <Avatar
              profil={{
                id: joueur.membreId,
                pseudo: joueur.pseudo,
                teinte: joueur.teinte,
                initiales: joueur.initiales,
                avatar: joueur.avatar,
              }}
              taille={24}
              anneau={joueur.membreId === tourDe}
            />
            <motion.span
              key={joueur.points}
              initial={{ scale: 1.35 }}
              animate={{ scale: 1 }}
              transition={RESSORT.chiffre}
              className={`text-[15px] font-semibold tabular-nums ${
                mene ? "text-encre" : "text-encre-3"
              }`}
            >
              {joueur.points}
            </motion.span>
            {joueur.sobre && (
              <span aria-label="au volant" title="au volant" className="text-[12px]">
                🚗
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
