"use client";

import type { ReactNode } from "react";

/**
 * Interrupteur d'un déclencheur. Le libellé fait partie de la zone cliquable
 * — sur téléphone, viser une pastille de 20 pixels est une punition.
 */
export function Bascule({
  actif,
  onChange,
  libelle,
  description,
  icone,
  couleur,
}: {
  actif: boolean;
  onChange: (actif: boolean) => void;
  libelle: string;
  description?: string;
  icone?: ReactNode;
  couleur: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      onClick={() => onChange(!actif)}
      style={actif ? { borderColor: couleur } : undefined}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
        actif ? "bg-surface-2" : "border-bordure bg-surface hover:bg-surface-2"
      }`}
    >
      <span
        aria-hidden
        style={{ color: actif ? couleur : undefined }}
        className={actif ? "" : "text-faible"}
      >
        {icone}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{libelle}</span>
        {description && (
          <span className="block text-xs leading-snug text-attenue">{description}</span>
        )}
      </span>

      <span
        aria-hidden
        style={actif ? { backgroundColor: couleur } : undefined}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          actif ? "" : "bg-surface-3"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-sm transition-all ${
            actif ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
