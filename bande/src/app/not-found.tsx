import Link from "next/link";

/**
 * La page qui n'existe pas.
 *
 * Sans ce fichier, Next sert sa page par défaut : « This page could not be
 * found », en anglais, sur fond blanc, sans rien du reste. Une application
 * annoncée « 100 % en français » ne peut pas se terminer par une phrase
 * anglaise, et c'est justement l'écran qu'on ne pense jamais à regarder.
 *
 * Elle sert aussi de réponse aux adresses qu'on essaie : une partie ou un
 * scellé d'une autre bande arrive ici, exactement comme une adresse inventée.
 * De l'extérieur, les deux cas doivent être indiscernables — la différence
 * dirait que la chose existe.
 */
export default function Introuvable() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
      <p aria-hidden className="text-[44px]">🫥</p>
      <h1 className="mt-3 text-[24px] font-semibold tracking-tight">Introuvable</h1>
      <p className="mt-2 max-w-[30ch] text-[15px] leading-snug text-encre-2">
        Cette page n&apos;existe pas, ou elle ne t&apos;appartient pas. Dans les deux cas,
        il n&apos;y a rien à voir ici.
      </p>
      <Link
        href="/"
        className="cible-tactile mt-7 rounded-[var(--radius-pilule)] bg-encre px-5 py-3 text-[16px] font-semibold text-surface"
      >
        Revenir au fil
      </Link>
    </main>
  );
}
