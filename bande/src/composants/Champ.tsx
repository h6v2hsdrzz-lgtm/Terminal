import type { ReactNode } from "react";

/**
 * Un champ de formulaire.
 *
 * Le libellé est un vrai `<label>` lié au champ : c'est ce qui fait qu'on peut
 * cliquer dessus pour donner le focus, et ce qu'un lecteur d'écran annonce.
 */
export function Champ({
  id,
  libelle,
  aide,
  children,
}: {
  id: string;
  libelle: string;
  aide?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-medium">
        {libelle}
      </label>
      {children}
      {aide && <p className="mt-1.5 text-[13px] leading-snug text-encre-3">{aide}</p>}
    </div>
  );
}

export const styleChamp =
  "w-full rounded-2xl border border-trait-fort bg-surface px-4 py-3 text-[16px] " +
  "placeholder:text-encre-3 focus:border-encre-3 focus:outline-none focus:ring-2 " +
  "focus:ring-[color-mix(in_oklab,var(--encre)_12%,transparent)]";

/** Les codes se lisent caractère par caractère : chasse fixe et lettres espacées. */
export const styleChampCode = `${styleChamp} chiffres text-center text-[20px] tracking-[0.25em] uppercase`;

export function MessageErreur({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-2xl border border-trait-fort bg-surface-2 px-4 py-3 text-[14px] leading-snug"
    >
      {children}
    </p>
  );
}

export function BoutonPrincipal({
  children,
  enCours,
  ...reste
}: { children: ReactNode; enCours?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      // Explicite : dans un formulaire, `submit` est déjà la valeur par défaut,
      // mais l'écrire évite qu'un bouton déplacé hors du formulaire se mette
      // silencieusement à ne rien faire.
      type="submit"
      {...reste}
      disabled={enCours || reste.disabled}
      style={{ background: "var(--encre)", color: "var(--surface)" }}
      className="w-full rounded-[var(--radius-pilule)] py-3.5 text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-55"
    >
      {enCours ? "Un instant…" : children}
    </button>
  );
}
