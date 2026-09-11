"use client";

import { useState, useTransition } from "react";

import { actionRetirerCopies } from "@/lib/actions";

/**
 * « Retirer les copies », avec une confirmation en deux temps.
 *
 * Un seul tap effacerait des souvenirs sur un écran qui parle de méga-octets —
 * le genre d'endroit où l'on touche vite. Le deuxième tap dit ce qui part.
 */
export function BoutonCopies({ empreinte }: { empreinte: string }) {
  const [confirme, setConfirme] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  if (erreur) {
    return (
      <span role="alert" className="max-w-[45%] text-right text-[12px] leading-snug text-encre-3">
        {erreur}
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={enCours}
      onClick={() => {
        if (!confirme) {
          setConfirme(true);
          return;
        }
        demarrer(async () => {
          const etat = await actionRetirerCopies(empreinte);
          if (etat.erreur) setErreur(etat.erreur);
        });
      }}
      className={`cible-tactile shrink-0 rounded-[var(--radius-pilule)] border px-3 py-1.5 text-[13px] transition ${
        confirme ? "border-encre-3 bg-surface-3 font-medium" : "border-trait bg-surface-2 text-encre-2"
      }`}
    >
      {enCours ? "…" : confirme ? "Confirmer" : "Retirer les copies"}
    </button>
  );
}
