"use client";

import { useState } from "react";

import { Carte } from "./Carte";

/**
 * Le code d'invitation, à dicter ou à copier.
 *
 * Il s'affiche en clair : ce n'est pas un secret personnel, c'est la porte
 * d'entrée de la bande, et il n'a d'utilité que partagé. Le bouton copie tout
 * ce qu'il faut envoyer, adresse comprise — recopier six caractères dans un
 * message est exactement le genre de friction qui fait qu'on n'invite personne.
 */
export function BoiteInvitation({ code, places }: { code: string; places: number }) {
  const [copie, setCopie] = useState(false);

  async function copier() {
    const texte = `Rejoins notre journal de joie : ${window.location.origin}/bienvenue/rejoindre — code ${code}`;
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2000);
    } catch {
      // Presse-papiers refusé (page non sécurisée, permission) : le code reste
      // affiché juste au-dessus, il suffit de le lire.
    }
  }

  return (
    <Carte className="p-4">
      <div className="flex items-center gap-3">
        {/* L'espacement des lettres rend le code lisible mais le fait épeler
            n'importe comment par un lecteur d'écran : le libellé rétablit ce
            qu'il faut entendre. */}
        <p
          id="code-invitation"
          aria-label={`Code d'invitation de la bande : ${code.split("").join(" ")}`}
          className="chiffres flex-1 rounded-2xl bg-surface-2 py-3 text-center text-[24px] tracking-[0.22em]"
        >
          {code}
        </p>
        <button
          type="button"
          onClick={copier}
          className="shrink-0 rounded-[var(--radius-pilule)] border border-trait-fort bg-surface px-4 py-3 text-[14px] font-medium transition hover:border-encre-3"
        >
          {copie ? "Copié" : "Copier"}
        </button>
      </div>
      <p className="mt-2.5 text-[13px] leading-snug text-encre-3">
        {places > 0
          ? `Encore ${places} place${places > 1 ? "s" : ""} dans la bande.`
          : "La bande est au complet."}
      </p>
    </Carte>
  );
}
