import { couleurProfil } from "@/lib/couleurs";
import type { Profil } from "@/lib/types";

/**
 * La couleur d'une personne est sa signature : on la retrouve sur son avatar,
 * sa courbe, la bordure de ses cartes. L'avatar porte les initiales tant qu'il
 * n'y a pas de photo.
 */
export function Avatar({
  profil,
  taille = 40,
  anneau = false,
  attenue = false,
}: {
  profil: Profil;
  taille?: number;
  anneau?: boolean;
  attenue?: boolean;
}) {
  const couleur = couleurProfil(profil);
  return (
    <span
      aria-hidden
      style={{
        width: taille,
        height: taille,
        fontSize: taille * 0.36,
        background: attenue ? "var(--surface-2)" : `color-mix(in oklab, ${couleur} 16%, var(--surface))`,
        color: attenue ? "var(--encre-3)" : couleur,
        boxShadow: anneau ? `0 0 0 2px var(--surface), 0 0 0 4px ${couleur}` : undefined,
        border: attenue ? "1px dashed var(--trait-fort)" : `1px solid color-mix(in oklab, ${couleur} 28%, transparent)`,
      }}
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold tracking-tight select-none"
    >
      {profil.initiales}
    </span>
  );
}
