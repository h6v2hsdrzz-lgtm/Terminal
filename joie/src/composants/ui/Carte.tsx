import type { ReactNode } from "react";

/** Le conteneur de toutes les sections : un fond, une bordure, rien d'autre. */
export function Carte({
  titre,
  sousTitre,
  icone,
  actions,
  children,
  className = "",
}: {
  titre?: string;
  sousTitre?: string;
  icone?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-bordure bg-surface shadow-[var(--ombre)] ${className}`}
    >
      {(titre || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-bordure px-4 py-3 sm:px-5">
          <div className="flex items-start gap-2.5">
            {icone && <span className="mt-0.5 text-ardoise">{icone}</span>}
            <div>
              {titre && <h2 className="text-sm font-semibold tracking-tight">{titre}</h2>}
              {sousTitre && <p className="mt-0.5 text-xs text-attenue">{sousTitre}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
