"use client";

import { Baby, Gauge, Leaf, Minus, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import type { ReactNode } from "react";

import {
  COULEURS_PERSONNES,
  ECHANTILLON_FIABLE,
  JOIE_MAX,
  type CleDeclencheur,
} from "@/lib/constantes";
import {
  arrondir,
  declencheurLePlusInfluent,
  joursCouverts,
  moyenneGlobale,
  statistiquesParPersonne,
} from "@/lib/analyse";
import type { Entree } from "@/lib/types";

const ICONE_DECLENCHEUR: Record<CleDeclencheur, ReactNode> = {
  biberon: <Baby size={16} />,
  planteVerte: <Leaf size={16} />,
};

function format(valeur: number | null, decimales = 1): string {
  const arrondi = arrondir(valeur, decimales);
  return arrondi === null ? "—" : arrondi.toFixed(decimales).replace(".", ",");
}

function Tuile({
  etiquette,
  children,
  className = "",
}: {
  etiquette: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-bordure bg-surface p-4 shadow-[var(--ombre)] ${className}`}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-attenue">
        {etiquette}
      </div>
      {children}
    </div>
  );
}

/** Jauge horizontale : la moyenne rapportée à l'échelle complète, 0 → 10. */
function Jauge({ valeur, couleur }: { valeur: number | null; couleur: string }) {
  const part = valeur === null ? 0 : Math.max(0, Math.min(1, valeur / JOIE_MAX)) * 100;
  return (
    <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${part}%`, backgroundColor: couleur }}
      />
    </div>
  );
}

function Tendance({ valeur }: { valeur: number | null }) {
  if (valeur === null || Math.abs(valeur) < 0.05) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-faible">
        <Minus size={12} /> stable
      </span>
    );
  }
  const hausse = valeur > 0;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium"
      style={{ color: hausse ? "var(--vert-texte)" : "var(--rouge)" }}
      title="Moyenne des 7 dernières mesures comparée aux 7 précédentes"
    >
      {hausse ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {hausse ? "+" : "−"}
      {format(Math.abs(valeur))} pts
    </span>
  );
}

export function Kpis({ entrees }: { entrees: Entree[] }) {
  const globale = moyenneGlobale(entrees);
  const parPersonne = statistiquesParPersonne(entrees);
  const influent = declencheurLePlusInfluent(entrees);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {/* Moyenne collective */}
      <Tuile
        etiquette={
          <>
            <Gauge size={14} /> Moyenne générale
          </>
        }
        className="col-span-2 sm:col-span-3 xl:col-span-2"
      >
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold tabulaire leading-none">{format(globale)}</span>
          <span className="text-sm text-faible">/ {JOIE_MAX}</span>
        </div>
        <Jauge valeur={globale} couleur="var(--ardoise)" />
        <p className="mt-2 text-xs text-attenue tabulaire">
          {entrees.length} mesure{entrees.length > 1 ? "s" : ""} · {joursCouverts(entrees)} jour
          {joursCouverts(entrees) > 1 ? "s" : ""} couvert{joursCouverts(entrees) > 1 ? "s" : ""}
        </p>
      </Tuile>

      {/* Moyennes individuelles */}
      {parPersonne.map((stat) => (
        <Tuile
          key={stat.personne}
          etiquette={
            <>
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: COULEURS_PERSONNES[stat.personne] }}
              />
              {stat.personne}
            </>
          }
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-3xl font-semibold tabulaire leading-none"
                style={{ color: COULEURS_PERSONNES[stat.personne] }}
              >
                {format(stat.moyenne)}
              </span>
              <span className="text-xs text-faible">/ {JOIE_MAX}</span>
            </div>
            <Tendance valeur={stat.tendance} />
          </div>
          <Jauge valeur={stat.moyenne} couleur={COULEURS_PERSONNES[stat.personne]} />
          <p className="mt-2 text-xs text-attenue tabulaire">
            {stat.nombre} mesure{stat.nombre > 1 ? "s" : ""}
          </p>
        </Tuile>
      ))}

      {/* Déclencheur le plus influent */}
      <Tuile
        etiquette={
          <>
            <Trophy size={14} /> Déclencheur le plus influent
          </>
        }
        className="sm:col-span-3 xl:col-span-1"
      >
        {influent ? (
          <>
            <div className="flex items-center gap-2">
              <span
                style={{
                  color:
                    influent.cle === "planteVerte" ? "var(--vert)" : "var(--ardoise)",
                }}
              >
                {ICONE_DECLENCHEUR[influent.cle]}
              </span>
              <span className="truncate text-base font-semibold">{influent.libelle}</span>
            </div>
            <p className="mt-1.5 text-2xl font-semibold tabulaire leading-none text-vert-texte">
              +{format(influent.delta)} <span className="text-sm font-normal text-attenue">pts</span>
            </p>
            <p className="mt-2 text-xs text-attenue tabulaire">
              avec {format(influent.moyenneAvec)} ({influent.nAvec}) · sans{" "}
              {format(influent.moyenneSans)} ({influent.nSans})
            </p>
            {!influent.fiable && (
              <p className="mt-1 text-[11px] text-ambre-texte">
                Moins de {ECHANTILLON_FIABLE} mesures d&apos;un côté : écart encore fragile.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-attenue">
            Aucun écart positif mesurable pour l&apos;instant — il faut des journées avec
            <em> et </em> sans chaque déclencheur.
          </p>
        )}
      </Tuile>
    </div>
  );
}
