"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ErreurApi } from "@/lib/api";
import type { Entree, SaisieEntree } from "@/lib/types";
import { validerSaisie, type Champ } from "@/lib/validation";

import { ChampsEntree } from "./ChampsEntree";
import { useJournal } from "./FournisseurJournal";

/** Modification d'une entrée existante, dans les mêmes champs que la saisie. */
export function DialogueEdition({
  entree,
  onFermer,
}: {
  entree: Entree;
  onFermer: () => void;
}) {
  const { modifier, signaler } = useJournal();
  const [valeur, setValeur] = useState<SaisieEntree>({
    date: entree.date,
    personne: entree.personne,
    joie: entree.joie,
    biberon: entree.biberon,
    planteVerte: entree.planteVerte,
    notes: entree.notes,
  });
  const [erreurs, setErreurs] = useState<Partial<Record<Champ, string>>>({});
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer();
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [onFermer]);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    const controle = validerSaisie(valeur);
    if (!controle.ok) {
      setErreurs(controle.erreurs);
      return;
    }

    setEnvoiEnCours(true);
    try {
      await modifier(entree.id, controle.valeur);
      signaler("Entrée modifiée.");
      onFermer();
    } catch (erreur) {
      if (erreur instanceof ErreurApi) {
        setErreurs(erreur.erreurs);
        signaler(erreur.message, "erreur");
      } else {
        signaler("Modification impossible — le serveur ne répond pas.", "erreur");
      }
      setEnvoiEnCours(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modifier une entrée"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFermer();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-bordure bg-surface shadow-[var(--ombre)] sm:rounded-2xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-bordure bg-surface px-4 py-3">
          <h2 className="text-sm font-semibold">Modifier l&apos;entrée</h2>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="text-faible transition hover:text-texte"
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={soumettre} noValidate className="p-4 sm:p-5">
          <ChampsEntree
            valeur={valeur}
            onChange={setValeur}
            erreurs={erreurs}
            idPrefixe={`edition-${entree.id}`}
          />

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onFermer}
              className="flex-1 rounded-xl border border-bordure px-4 py-2.5 text-sm font-medium text-attenue transition hover:bg-surface-2 hover:text-texte"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={envoiEnCours}
              style={{ backgroundColor: "var(--action)", color: "var(--action-texte)" }}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-70"
            >
              {envoiEnCours && <Loader2 size={16} className="animate-spin" />}
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
