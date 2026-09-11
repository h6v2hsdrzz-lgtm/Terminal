"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { motion } from "motion/react";

import { actionRejoindreSalon } from "@/lib/actions-jeux";
import { RESSORT } from "@/lib/mouvement";

/**
 * « Une partie t'attend. »
 *
 * En haut de l'accueil, parce que c'est le premier écran, et qu'une invitation
 * qui demande d'aller la chercher dans un onglet n'est pas une invitation.
 *
 * Il ne s'affiche que pour ceux qui ne sont pas encore dedans : celui qui a
 * ouvert le salon n'a pas besoin qu'on l'invite chez lui.
 */
export function BandeauSalon({
  partieId,
  jeu,
  emoji,
  hote,
  combien,
}: {
  partieId: string;
  jeu: string;
  emoji: string;
  hote: string;
  combien: number;
}) {
  const [enCours, demarrer] = useTransition();
  const router = useRouter();

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={RESSORT.moyen}
      disabled={enCours}
      onClick={() =>
        demarrer(async () => {
          const reponse = await actionRejoindreSalon({ partieId });
          if (reponse.valeur) router.push(`/jeux/${reponse.valeur}`);
        })
      }
      style={{ background: "var(--encre)", color: "var(--surface)" }}
      className="mb-4 flex w-full items-center gap-3 rounded-[var(--radius-carte)] px-4 py-3.5 text-left shadow-[var(--ombre-2)] disabled:opacity-60"
    >
      <span aria-hidden className="text-[22px]">
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">
          {hote} lance {jeu}
        </span>
        <span className="block text-[13px] opacity-75">
          {combien === 1 ? "Il attend tout seul" : `${combien} déjà dans le salon`} — touche pour
          rejoindre
        </span>
      </span>
      <span aria-hidden className="shrink-0 opacity-75">
        →
      </span>
    </motion.button>
  );
}
