"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";

/**
 * Tirer vers le bas pour rafraîchir.
 *
 * Le fil se met déjà à jour tout seul (`Synchronisation` sonde toutes les
 * trois secondes), donc ce geste ne sert pas à ça : il sert à **vérifier**.
 * On tire parce qu'on doute, et une application qui ne répond pas à ce geste
 * donne l'impression d'être figée, même quand elle est à jour.
 *
 * Sur iOS, le geste doit cohabiter avec le rebond natif de Safari, qu'on ne
 * peut ni désactiver ni détecter proprement. Trois précautions :
 *
 * · on ne commence à écouter que si la page est **exactement** en haut, sinon
 *   on vole le défilement à l'utilisateur ;
 * · on n'appelle jamais `preventDefault` (l'écouteur est passif) : couper le
 *   défilement natif pendant le rebond fait sauter la page d'un coup ;
 * · la distance est amortie — 120 px de doigt donnent 60 px d'indicateur —
 *   pour que le geste ait une fin, au lieu de suivre le doigt à l'infini.
 */
const DECLENCHEMENT_PX = 72;
const AMORTI = 0.5;

export function TirerPourRafraichir() {
  const router = useRouter();
  const [tire, setTire] = useState(0);
  const [enCours, demarrer] = useTransition();
  const depart = useRef<number | null>(null);

  useEffect(() => {
    function commencer(e: TouchEvent) {
      depart.current = window.scrollY <= 0 ? (e.touches[0]?.clientY ?? null) : null;
    }

    function bouger(e: TouchEvent) {
      if (depart.current === null || enCours) return;
      const delta = (e.touches[0]?.clientY ?? 0) - depart.current;
      // Un geste vers le haut n'est pas un tirage : on lâche et on laisse
      // le défilement normal reprendre la main.
      if (delta <= 0) {
        depart.current = null;
        setTire(0);
        return;
      }
      setTire(Math.min(delta * AMORTI, DECLENCHEMENT_PX * 1.6));
    }

    function finir() {
      if (depart.current === null) return;
      const assez = tire >= DECLENCHEMENT_PX;
      depart.current = null;
      if (!assez) {
        setTire(0);
        return;
      }
      if ("vibrate" in navigator) navigator.vibrate(12);
      demarrer(async () => {
        router.refresh();
        setTire(0);
      });
    }

    window.addEventListener("touchstart", commencer, { passive: true });
    window.addEventListener("touchmove", bouger, { passive: true });
    window.addEventListener("touchend", finir, { passive: true });
    window.addEventListener("touchcancel", finir, { passive: true });
    return () => {
      window.removeEventListener("touchstart", commencer);
      window.removeEventListener("touchmove", bouger);
      window.removeEventListener("touchend", finir);
      window.removeEventListener("touchcancel", finir);
    };
  }, [enCours, router, tire]);

  const actif = tire > 0 || enCours;
  if (!actif) return null;

  const part = Math.min(tire / DECLENCHEMENT_PX, 1);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center"
      style={{ paddingTop: `calc(env(safe-area-inset-top) + ${Math.round(tire / 2)}px)` }}
    >
      <motion.span
        animate={enCours ? { rotate: 360 } : { rotate: part * 300 }}
        transition={enCours ? { repeat: Infinity, duration: 0.8, ease: "linear" } : { duration: 0 }}
        style={{ opacity: enCours ? 1 : part }}
        className="grid h-9 w-9 place-items-center rounded-full border border-trait bg-surface text-encre-2 shadow-[var(--ombre-1)]"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
          <path d="M21 3v6h-6" />
        </svg>
      </motion.span>
    </div>
  );
}
