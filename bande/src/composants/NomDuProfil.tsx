"use client";

import { useState, useTransition } from "react";

import { MessageErreur } from "./Champ";
import { actionRenommerMembre, actionRenommerMembreSimple } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import { LONGUEUR_PSEUDO } from "@/lib/initiales";

/**
 * Son propre nom, modifiable sur place.
 *
 * Pas d'écran de réglages pour ça : le nom est déjà affiché ici, on le touche
 * et on l'écrit. Un aller-retour vers un formulaire pour changer un mot serait
 * plus long à traverser qu'à taper.
 *
 * Le formulaire vise une vraie action serveur et l'interception ne sert qu'à
 * refermer le champ au bon moment. Sans action serveur derrière, React rend
 * `action="javascript:throw …"` et le formulaire lève dès que le JavaScript
 * n'a pas chargé.
 */
export function NomDuProfil({ pseudo }: { pseudo: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => { setEtat(ETAT_INITIAL); setOuvert(true); }}
        className="group flex min-w-0 items-center gap-1.5 text-left"
      >
        <h1 className="truncate text-[26px] font-semibold tracking-[-0.02em]">{pseudo}</h1>
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden
          className="shrink-0 text-encre-3 transition group-hover:text-encre-2"
        >
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        <span className="sr-only">Changer de nom</span>
      </button>
    );
  }

  return (
    <form
      action={actionRenommerMembreSimple}
      onSubmit={(evenement) => {
        evenement.preventDefault();
        const donnees = new FormData(evenement.currentTarget);
        demarrer(async () => {
          const resultat = await actionRenommerMembre(ETAT_INITIAL, donnees);
          setEtat(resultat);
          if (!resultat.erreur) setOuvert(false);
        });
      }}
      className="min-w-0"
    >
      <label htmlFor="pseudo" className="sr-only">Ton nom dans la bande</label>
      <div className="flex items-center gap-2">
        <input
          id="pseudo"
          name="pseudo"
          defaultValue={pseudo}
          required
          maxLength={LONGUEUR_PSEUDO}
          autoComplete="nickname"
          autoFocus
          className="champ-saisie min-w-0 flex-1 rounded-2xl border border-trait bg-surface-2 px-3 py-2 font-semibold focus:border-trait-fort focus:outline-none"
        />
        <button
          type="submit"
          disabled={enCours}
          style={{ background: "var(--encre)", color: "var(--surface)" }}
          className="cible-tactile shrink-0 rounded-[var(--radius-pilule)] px-3.5 py-2 text-[14px] font-semibold disabled:opacity-50"
        >
          {enCours ? "…" : "Garder"}
        </button>
      </div>
      {etat.erreur && <div className="mt-2"><MessageErreur>{etat.erreur}</MessageErreur></div>}
      <button
        type="button"
        onClick={() => setOuvert(false)}
        className="mt-1.5 text-[13px] text-encre-3 underline underline-offset-2"
      >
        laisser comme ça
      </button>
    </form>
  );
}
