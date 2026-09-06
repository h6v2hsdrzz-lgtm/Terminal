"use client";

import { motion } from "motion/react";

import { Avatar } from "@/composants/Avatar";
import type { Joueur } from "@/lib/jeux/types";
import { RESSORT } from "@/lib/mouvement";

/**
 * La révélation : les votes découverts **en même temps**.
 *
 * C'est le seul moment qui compte dans ces jeux-là. Les cartes apparaissent
 * ensemble, pas l'une après l'autre : un dévoilement séquentiel donne
 * l'information au fur et à mesure, et le troisième vote n'a plus de saveur
 * quand les deux premiers ont déjà tranché.
 */
export function RevelationVotes({
  joueurs,
  votes,
  libelle,
  sanctions,
}: {
  joueurs: Joueur[];
  /** Ce que chacun a choisi, par identifiant de membre. */
  votes: Record<string, string>;
  /** Comment écrire un choix — « la gauche », le pseudo désigné… */
  libelle: (choix: string) => string;
  /** Ce que chacun doit, s'il doit quelque chose. */
  sanctions?: Record<string, string>;
}) {
  return (
    <ul className="mt-5 space-y-2.5">
      {joueurs.map((joueur, i) => (
        <motion.li
          key={joueur.membreId}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          // Tous ensemble, à quelques millisecondes près : assez pour que ça
          // respire, pas assez pour dévoiler dans l'ordre.
          transition={{ ...RESSORT.moyen, delay: i * 0.03 }}
          className="flex items-start gap-3"
        >
          <Avatar
            profil={{
              id: joueur.membreId,
              pseudo: joueur.pseudo,
              teinte: joueur.teinte,
              initiales: joueur.initiales,
              avatar: joueur.avatar,
            }}
            taille={32}
          />
          <span className="min-w-0 flex-1 pt-0.5">
            <span className="block text-[15px] font-semibold">{joueur.pseudo}</span>
            <span className="block text-[14px] leading-snug text-encre-2">
              {votes[joueur.membreId] ? libelle(votes[joueur.membreId]) : "n'a pas répondu"}
              {sanctions?.[joueur.membreId] ? ` — ${sanctions[joueur.membreId]}` : ""}
            </span>
          </span>
        </motion.li>
      ))}
    </ul>
  );
}
