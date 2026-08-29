"use client";

import { Activity } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { serieTemporelle, type PointTemporel } from "@/lib/analyse";
import { COULEURS_PERSONNES, JOIE_MAX, PERSONNES, type Personne } from "@/lib/constantes";
import { decalerIso, aujourdhuiIso, isoVersJourMois, isoVersTexte } from "@/lib/date";
import type { Entree } from "@/lib/types";

import { Carte } from "./ui/Carte";
import { Segments } from "./ui/Segments";

/** Fenêtres de lecture. « Tout » reste le repli quand l'historique est court. */
const FENETRES = [
  { valeur: "30", libelle: "30 j" },
  { valeur: "90", libelle: "90 j" },
  { valeur: "tout", libelle: "Tout" },
] as const;

type Fenetre = (typeof FENETRES)[number]["valeur"];

/**
 * Chaque personne a sa forme de point en plus de sa couleur : sur un tracé,
 * la couleur seule ne suffit pas à distinguer trois courbes quand on ne
 * perçoit pas les rouges ou les verts.
 */
const FORMES: Record<Personne, "cercle" | "carre" | "triangle"> = {
  Momo: "cercle",
  Sam: "carre",
  Samy: "triangle",
};

function Marqueur({
  cx,
  cy,
  personne,
}: {
  cx?: number;
  cy?: number;
  personne: Personne;
}) {
  if (cx === undefined || cy === undefined) return null;
  const couleur = COULEURS_PERSONNES[personne];
  const commun = { fill: couleur, stroke: "var(--surface)", strokeWidth: 2 };

  switch (FORMES[personne]) {
    case "carre":
      return <rect x={cx - 4} y={cy - 4} width={8} height={8} rx={1} {...commun} />;
    case "triangle":
      return <polygon points={`${cx},${cy - 5} ${cx + 5},${cy + 4} ${cx - 5},${cy + 4}`} {...commun} />;
    default:
      return <circle cx={cx} cy={cy} r={4} {...commun} />;
  }
}

function Infobulle({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PointTemporel }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-xl border border-bordure bg-surface px-3 py-2 text-xs shadow-[var(--ombre)]">
      <p className="mb-1.5 font-medium">{isoVersTexte(point.date)}</p>
      <ul className="space-y-1">
        {PERSONNES.map((personne) => {
          const valeur = point[personne];
          if (valeur === null) return null;
          const declencheurs = point.declencheurs[personne];
          return (
            <li key={personne} className="flex items-center gap-2 tabulaire">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: COULEURS_PERSONNES[personne] }}
              />
              <span className="flex-1 text-attenue">{personne}</span>
              <span className="font-medium">{valeur}</span>
              <span className="w-8 text-right" aria-hidden>
                {declencheurs?.biberon ? "🍼" : ""}
                {declencheurs?.planteVerte ? "🌿" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function GraphiqueTemporel({ entrees }: { entrees: Entree[] }) {
  const [fenetre, setFenetre] = useState<Fenetre>("30");

  const points = useMemo(() => {
    const serie = serieTemporelle(entrees);
    if (fenetre === "tout") return serie;
    const depuis = decalerIso(aujourdhuiIso(), -Number(fenetre));
    const fenetree = serie.filter((point) => point.date >= depuis);
    // Une fenêtre vide n'apprend rien : on retombe sur l'historique complet.
    return fenetree.length > 0 ? fenetree : serie;
  }, [entrees, fenetre]);

  return (
    <Carte
      titre="Évolution du niveau de joie"
      sousTitre="Une courbe par personne, échelle 0 à 10"
      icone={<Activity size={16} />}
      actions={
        <Segments
          etiquette="Fenêtre affichée"
          taille="compacte"
          valeur={fenetre}
          onChange={(v: Fenetre) => setFenetre(v)}
          segments={FENETRES.map((f) => ({ valeur: f.valeur, libelle: f.libelle }))}
        />
      }
    >
      {points.length === 0 ? (
        <p className="py-12 text-center text-sm text-attenue">
          Aucune mesure pour l&apos;instant — la première saisie tracera le premier point.
        </p>
      ) : (
        <>
          {/* Légende : l'identité ne repose jamais sur la seule couleur, la
              forme du marqueur la double. */}
          <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {PERSONNES.map((personne) => (
              <li key={personne} className="flex items-center gap-1.5 text-attenue">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                  <g transform="translate(6,6)">
                    <Marqueur cx={0} cy={0} personne={personne} />
                  </g>
                </svg>
                {personne}
              </li>
            ))}
          </ul>

          <div className="h-[260px] w-full sm:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="var(--grille)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={isoVersJourMois}
                  tick={{ fill: "var(--faible)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--grille)" }}
                  minTickGap={24}
                />
                <YAxis
                  domain={[0, JOIE_MAX]}
                  ticks={[0, 2, 4, 6, 8, 10]}
                  tick={{ fill: "var(--faible)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip
                  content={<Infobulle />}
                  cursor={{ stroke: "var(--bordure-2)", strokeWidth: 1 }}
                />
                {PERSONNES.map((personne) => (
                  <Line
                    key={personne}
                    type="monotone"
                    dataKey={personne}
                    name={personne}
                    stroke={COULEURS_PERSONNES[personne]}
                    strokeWidth={2}
                    connectNulls
                    dot={<Marqueur personne={personne} />}
                    activeDot={{ r: 6, stroke: "var(--surface)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Carte>
  );
}
