"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Carte } from "@/composants/Carte";
import { actionRejoindreSalon } from "@/lib/actions-jeux";
import { codeValide } from "@/lib/jeux/salon";

/**
 * Rejoindre par le code.
 *
 * Le bandeau de l'accueil couvre le cas normal ; celui-ci couvre tout le reste
 * — l'application fermée, la notification qui n'arrive pas, le téléphone qui
 * vient de redémarrer. Quatre chiffres se dictent à voix haute d'un bout à
 * l'autre d'une cuisine, ce qu'un lien ne fait pas.
 *
 * `inputMode="numeric"` fait sortir le pavé numérique sur iOS sans passer par
 * `type="number"`, qui ajouterait des flèches et accepterait « 1e4 ».
 */
export function BoiteRejoindre() {
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const router = useRouter();

  function rejoindre() {
    setErreur(null);
    demarrer(async () => {
      const reponse = await actionRejoindreSalon({ code });
      if (reponse.erreur || !reponse.valeur) {
        setErreur(reponse.erreur ?? "Ce code ne mène nulle part.");
        return;
      }
      router.push(`/jeux/${reponse.valeur}`);
    });
  }

  return (
    <Carte className="p-4">
      <label htmlFor="code-partie" className="text-[13px] font-medium text-encre-2">
        Rejoindre une partie
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="code-partie"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && codeValide(code)) rejoindre();
          }}
          inputMode="numeric"
          autoComplete="off"
          placeholder="4 chiffres"
          className="champ-saisie chiffres min-w-0 flex-1 rounded-2xl border border-trait bg-surface-2 px-4 py-2.5 tracking-[0.2em] placeholder:tracking-normal placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
        />
        <button
          type="button"
          onClick={rejoindre}
          disabled={enCours || !codeValide(code)}
          style={{ background: "var(--encre)", color: "var(--surface)" }}
          className="shrink-0 rounded-[var(--radius-pilule)] px-5 text-[15px] font-semibold transition disabled:opacity-40"
        >
          {enCours ? "…" : "Entrer"}
        </button>
      </div>
      {erreur && (
        <p role="alert" className="mt-2 text-[13px] text-encre-2">
          {erreur}
        </p>
      )}
    </Carte>
  );
}
