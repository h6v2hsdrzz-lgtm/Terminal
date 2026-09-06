"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { Avatar } from "@/composants/Avatar";
import { RESSORT } from "@/lib/mouvement";
import type { Joueur } from "@/lib/jeux/types";

/**
 * La fin de partie.
 *
 * Trois marches qui montent l'une après l'autre, de la troisième à la
 * première : l'ordre d'arrivée de l'animation raconte le classement mieux
 * qu'un tableau. Puis ce que la partie a rapporté en points d'application —
 * annoncé, pas découvert plus tard dans le profil.
 *
 * Personne n'est « perdant » : la dernière marche existe, elle est basse, et
 * elle rapporte quand même quelque chose.
 */
const HAUTEURS = [96, 68, 48];

export function Podium({
  joueurs,
  recompenses,
}: {
  joueurs: Joueur[];
  recompenses: { membreId: string; place: number; points: number }[];
}) {
  const parId = new Map(joueurs.map((j) => [j.membreId, j]));
  const classes = [...recompenses].sort((a, b) => a.place - b.place);
  // L'ordre visuel d'un podium : deuxième, premier, troisième.
  const ordreVisuel = [classes[1], classes[0], classes[2]].filter(Boolean);

  /**
   * Une partie sans vainqueur — « Je n'ai jamais » ne compte rien, et une
   * égalité parfaite arrive ailleurs. Trois marches de même hauteur ne veulent
   * rien dire ; une rangée d'avatars, si.
   */
  const personneNeGagne = classes.length > 1 && classes.every((c) => c.place === 1);

  if (personneNeGagne) {
    return (
      <div className="px-4 py-8">
        <h2 className="text-center text-[24px] font-semibold tracking-tight">C&apos;est fini</h2>
        <p className="mt-2 text-center text-[15px] text-encre-2">
          Personne ne gagne à ce jeu-là, et c&apos;est très bien.
        </p>
        <div className="mt-8 flex flex-wrap items-start justify-center gap-5">
          {classes.map((recompense, i) => {
            const joueur = parId.get(recompense.membreId);
            if (!joueur) return null;
            return (
              <motion.div
                key={recompense.membreId}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...RESSORT.moyen, delay: i * 0.1 }}
                className="flex w-[84px] flex-col items-center"
              >
                <Avatar
                  profil={{
                    id: joueur.membreId,
                    pseudo: joueur.pseudo,
                    teinte: joueur.teinte,
                    initiales: joueur.initiales,
                    avatar: joueur.avatar,
                  }}
                  taille={48}
                />
                <p className="mt-1.5 max-w-full truncate text-[14px] font-semibold">
                  {joueur.pseudo}
                </p>
                <p className="text-[13px] tabular-nums text-encre-3">
                  +{recompense.points}
                </p>
              </motion.div>
            );
          })}
        </div>
        <Link
          href="/jeux"
          className="cible-tactile mt-10 block w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-center text-[16px] font-semibold text-surface"
        >
          Revenir aux jeux
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-8">
      <h2 className="text-center text-[24px] font-semibold tracking-tight">C&apos;est fini</h2>

      <div className="mt-8 flex items-end justify-center gap-2.5">
        {ordreVisuel.map((recompense) => {
          const joueur = parId.get(recompense.membreId);
          if (!joueur) return null;
          const hauteur = HAUTEURS[Math.min(recompense.place, 3) - 1] ?? 40;
          return (
            <div key={recompense.membreId} className="flex w-[92px] flex-col items-center">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                // Le troisième monte d'abord, le premier en dernier.
                transition={{ ...RESSORT.moyen, delay: (4 - recompense.place) * 0.18 }}
                className="flex flex-col items-center"
              >
                <Avatar
                  profil={{
                    id: joueur.membreId,
                    pseudo: joueur.pseudo,
                    teinte: joueur.teinte,
                    initiales: joueur.initiales,
                    avatar: joueur.avatar,
                  }}
                  taille={44}
                  anneau={recompense.place === 1}
                />
                <p className="mt-1.5 max-w-full truncate text-[14px] font-semibold">{joueur.pseudo}</p>
                <p className="text-[13px] tabular-nums text-encre-3">{joueur.points} pts de partie</p>
              </motion.div>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: hauteur }}
                transition={{ ...RESSORT.ample, delay: (4 - recompense.place) * 0.18 + 0.1 }}
                className="mt-2 w-full rounded-t-[var(--radius-carte)] bg-surface-3"
              />
            </div>
          );
        })}
      </div>

      <ul className="mt-8 space-y-1.5">
        {classes.map((recompense) => (
          <li
            key={recompense.membreId}
            className="flex items-baseline justify-between gap-3 text-[15px]"
          >
            <span>{parId.get(recompense.membreId)?.pseudo ?? "?"}</span>
            <span className="tabular-nums text-encre-2">
              {recompense.points > 0 ? `+${recompense.points}` : "0"} point
              {recompense.points > 1 ? "s" : ""} d&apos;app
            </span>
          </li>
        ))}
      </ul>
      {classes.some((c) => c.points === 0) && (
        <p className="mt-3 text-[13px] leading-snug text-encre-3">
          Zéro point, c&apos;est le plafond quotidien des jeux : il empêche une soirée
          de compter plus que trois mois de journal. La partie compte quand même.
        </p>
      )}

      <Link
        href="/jeux"
        className="cible-tactile mt-8 block w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-center text-[16px] font-semibold text-surface"
      >
        Revenir aux jeux
      </Link>
    </div>
  );
}
