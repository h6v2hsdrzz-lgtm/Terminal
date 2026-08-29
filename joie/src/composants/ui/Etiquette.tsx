import type { ReactNode } from "react";

/** Pastille d'état : déclencheur actif dans le tableau, mention discrète ailleurs. */
export function Etiquette({
  children,
  couleur,
  actif = true,
  titre,
}: {
  children: ReactNode;
  couleur?: string;
  actif?: boolean;
  titre?: string;
}) {
  return (
    <span
      title={titre}
      style={actif && couleur ? { color: couleur, borderColor: couleur } : undefined}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
        actif ? "bg-surface-2" : "border-bordure text-faible"
      }`}
    >
      {children}
    </span>
  );
}
