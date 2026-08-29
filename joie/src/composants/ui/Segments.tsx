"use client";

/**
 * Sélecteur segmenté. Utilisé pour le profil dans le formulaire et pour le
 * périmètre des graphiques : un seul choix, tous les choix visibles.
 */
export type Segment<T extends string> = {
  valeur: T;
  libelle: string;
  /** Couleur d'accent (variable CSS) quand le segment est actif. */
  couleur?: string;
};

export function Segments<T extends string>({
  segments,
  valeur,
  onChange,
  etiquette,
  taille = "normale",
}: {
  segments: readonly Segment<T>[];
  valeur: T;
  onChange: (valeur: T) => void;
  etiquette: string;
  taille?: "normale" | "compacte";
}) {
  const paddings = taille === "compacte" ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm";

  return (
    <div
      role="radiogroup"
      aria-label={etiquette}
      className="inline-flex w-full gap-1 rounded-xl border border-bordure bg-surface-2 p-1"
    >
      {segments.map((segment) => {
        const actif = segment.valeur === valeur;
        return (
          <button
            key={segment.valeur}
            type="button"
            role="radio"
            aria-checked={actif}
            onClick={() => onChange(segment.valeur)}
            // La teinte du profil habille la bordure ; le libellé garde l'encre
            // du texte, qui seule tient le contraste en petit corps.
            style={actif && segment.couleur ? { borderColor: segment.couleur } : undefined}
            className={`flex-1 rounded-lg border font-medium transition ${paddings} ${
              actif
                ? "border-bordure-2 bg-surface text-texte shadow-[var(--ombre)]"
                : "border-transparent text-attenue hover:bg-surface-3 hover:text-texte"
            }`}
          >
            {segment.libelle}
          </button>
        );
      })}
    </div>
  );
}
