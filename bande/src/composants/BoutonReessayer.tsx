"use client";

/**
 * « Réessayer » recharge vraiment la page.
 *
 * Un lien de navigation interne partirait du même document déjà servi par le
 * cache : on tournerait en rond sur la coquille hors ligne. Ce qu'on veut ici,
 * c'est que le navigateur retente le réseau — donc un rechargement franc.
 */
export function BoutonReessayer() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-6 rounded-[var(--radius-pilule)] border border-trait-fort bg-surface px-5 py-2.5 text-[14px] font-medium transition hover:border-encre-3"
    >
      Réessayer
    </button>
  );
}
