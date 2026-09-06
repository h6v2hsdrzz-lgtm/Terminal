import Image from "next/image";

import { couleurProfil } from "@/lib/couleurs";
import type { Profil } from "@/lib/types";

/**
 * La couleur d'une personne est sa signature : on la retrouve sur son avatar,
 * sa courbe, la bordure de ses cartes. L'avatar porte les initiales tant qu'il
 * n'y a pas de photo — et les initiales ne sont pas un pis-aller : elles sont
 * le second encodage, celui qui reste quand la couleur ne suffit pas.
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

  if (profil.avatar && !attenue) {
    return (
      <span
        aria-hidden
        style={{
          width: taille,
          height: taille,
          boxShadow: anneau ? `0 0 0 2px var(--surface), 0 0 0 4px ${couleur}` : undefined,
          border: `1px solid color-mix(in oklab, ${couleur} 28%, transparent)`,
        }}
        className="inline-block shrink-0 overflow-hidden rounded-full select-none"
      >
        {/* `unoptimized` : l'image est déjà carrée et compressée, et elle sort
            d'une route privée que l'optimiseur ne peut pas relire. */}
        <Image
          src={profil.avatar}
          alt=""
          width={256}
          height={256}
          unoptimized
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

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
