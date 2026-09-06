"use client";

import { useEffect } from "react";

/**
 * Ce qui reste quand quelque chose casse.
 *
 * Deux choix :
 *
 * **On ne montre pas le message d'erreur.** En production, Next le remplace
 * déjà par un texte générique, mais l'habitude compte : un message technique
 * affiché à trois amis ne les aide pas et peut nommer une table ou un chemin.
 *
 * **Il y a un bouton pour réessayer**, parce que la plupart de ces écrans
 * viennent d'un réseau qui a lâché une seconde, et que recharger la page
 * entière ferait perdre la place où l'on était.
 */
export default function Erreur({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Le digest est la seule chose qui relie cet écran à la trace côté serveur.
    console.error("Écran en erreur", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
      <p aria-hidden className="text-[44px]">🥴</p>
      <h1 className="mt-3 text-[24px] font-semibold tracking-tight">Ça a cassé</h1>
      <p className="mt-2 max-w-[30ch] text-[15px] leading-snug text-encre-2">
        Rien n&apos;est perdu : ce qui était enregistré l&apos;est toujours. C&apos;est
        l&apos;affichage qui n&apos;a pas tenu.
      </p>
      <button
        type="button"
        onClick={reset}
        className="cible-tactile mt-7 rounded-[var(--radius-pilule)] bg-encre px-5 py-3 text-[16px] font-semibold text-surface"
      >
        Réessayer
      </button>
    </main>
  );
}
