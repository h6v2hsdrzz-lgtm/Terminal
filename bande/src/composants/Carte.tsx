import type { ReactNode } from "react";

/**
 * Le conteneur commun : coins généreux, un trait d'un pixel, une ombre courte.
 * Rien d'autre — la matière ne doit pas se faire remarquer avant le contenu.
 */
export function Carte({
  children,
  className = "",
  accent,
  ...reste
}: {
  children: ReactNode;
  className?: string;
  /** Liseré coloré à gauche : la signature d'une personne. */
  accent?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...reste}
      style={accent ? { borderInlineStartColor: accent, borderInlineStartWidth: 3 } : undefined}
      className={`rounded-[var(--radius-carte)] border border-trait bg-surface shadow-[var(--ombre-1)] ${className}`}
    >
      {children}
    </div>
  );
}

export function TitreSection({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
        {children}
      </h2>
      {action}
    </div>
  );
}
