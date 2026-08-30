"use client";

import { Sparkles } from "lucide-react";

import type { Entree } from "@/lib/types";

import { BasculeTheme } from "./BasculeTheme";
import { FormulaireSaisie } from "./FormulaireSaisie";
import { FournisseurJournal, useJournal } from "./FournisseurJournal";
import { GraphiqueDeclencheurs } from "./GraphiqueDeclencheurs";
import { GraphiqueTemporel } from "./GraphiqueTemporel";
import { Historique } from "./Historique";
import { Kpis } from "./Kpis";
import { Notifications } from "./Notifications";

function Contenu() {
  const { entrees, horsLigne } = useJournal();

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-bordure bg-fond/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ardoise">
            <Sparkles size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-tight">Journal de joie</h1>
            <p className="truncate text-xs text-attenue">
              Momo, Sam &amp; Samy — biberon et plante verte
            </p>
          </div>
          <span
            title={
              horsLigne
                ? "Le serveur ne répond pas — les saisies faites ailleurs n'arrivent plus"
                : "Les saisies faites sur les autres appareils arrivent en quelques secondes"
            }
            className="hidden items-center gap-1.5 rounded-full border border-bordure bg-surface px-2.5 py-1 text-[11px] font-medium text-attenue sm:inline-flex"
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${horsLigne ? "bg-rouge" : "bg-vert"}`}
            />
            {horsLigne ? "Hors ligne" : "Synchronisé"}
          </span>
          <BasculeTheme />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">
        <Kpis entrees={entrees} />

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
          <div className="xl:sticky xl:top-20">
            <FormulaireSaisie />
          </div>

          <div className="space-y-4">
            <GraphiqueTemporel entrees={entrees} />
            <GraphiqueDeclencheurs entrees={entrees} />
          </div>
        </div>

        <Historique />
      </main>

      <footer className="mx-auto w-full max-w-7xl px-4 pb-8 text-xs text-faible sm:px-6">
        Les moyennes se lisent à la mesure près : un écart calculé sur trois journées
        n&apos;est pas une tendance.
      </footer>

      <Notifications />
    </>
  );
}

export function Application({
  entreesInitiales,
  versionInitiale,
}: {
  entreesInitiales: Entree[];
  versionInitiale: string;
}) {
  return (
    <FournisseurJournal entreesInitiales={entreesInitiales} versionInitiale={versionInitiale}>
      <Contenu />
    </FournisseurJournal>
  );
}
