"use client";

import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { comparaisonParPerimetre, type BarreComparaison } from "@/lib/analyse";
import { DECLENCHEURS, JOIE_MAX, type CleDeclencheur } from "@/lib/constantes";
import type { Entree } from "@/lib/types";

import { Carte } from "./ui/Carte";
import { Segments } from "./ui/Segments";

function Infobulle({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: BarreComparaison }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const barre = payload[0].payload;
  const ecart =
    barre.avec !== null && barre.sans !== null ? barre.avec - barre.sans : null;

  return (
    <div className="rounded-xl border border-bordure bg-surface px-3 py-2 text-xs shadow-[var(--ombre)]">
      <p className="mb-1.5 font-medium">{label}</p>
      <p className="tabulaire text-attenue">
        Avec : <span className="font-medium text-texte">{barre.avec ?? "—"}</span> ({barre.nAvec})
      </p>
      <p className="tabulaire text-attenue">
        Sans : <span className="font-medium text-texte">{barre.sans ?? "—"}</span> ({barre.nSans})
      </p>
      {ecart !== null && (
        <p
          className="mt-1 tabulaire font-medium"
          style={{ color: ecart >= 0 ? "var(--vert-texte)" : "var(--rouge)" }}
        >
          {ecart >= 0 ? "+" : "−"}
          {Math.abs(ecart).toFixed(2).replace(".", ",")} pt
        </p>
      )}
    </div>
  );
}

/**
 * Comparaison « avec » / « sans » pour un déclencheur, au niveau collectif
 * puis profil par profil. Deux barres côte à côte par périmètre : c'est la
 * forme qui rend un écart de moyennes lisible sans calcul mental.
 */
export function GraphiqueDeclencheurs({ entrees }: { entrees: Entree[] }) {
  const [cle, setCle] = useState<CleDeclencheur>("biberon");
  const donnees = useMemo(() => comparaisonParPerimetre(entrees, cle), [entrees, cle]);
  const declencheur = DECLENCHEURS.find((d) => d.cle === cle)!;
  const couleurAvec = cle === "planteVerte" ? "var(--vert)" : "var(--ardoise)";

  const vide = donnees.every((d) => d.avec === null && d.sans === null);

  return (
    <Carte
      titre="Effet des déclencheurs"
      sousTitre="Moyenne des journées avec, puis sans"
      icone={<BarChart3 size={16} />}
      actions={
        <Segments
          etiquette="Déclencheur comparé"
          taille="compacte"
          valeur={cle}
          onChange={(v: CleDeclencheur) => setCle(v)}
          segments={DECLENCHEURS.map((d) => ({ valeur: d.cle, libelle: d.libelle }))}
        />
      }
    >
      {vide ? (
        <p className="py-12 text-center text-sm text-attenue">
          Rien à comparer tant qu&apos;aucune journée n&apos;est enregistrée.
        </p>
      ) : (
        <>
          <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            <li className="flex items-center gap-1.5 text-attenue">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: couleurAvec }}
              />
              Avec {declencheur.libelle.toLowerCase()}
            </li>
            <li className="flex items-center gap-1.5 text-attenue">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-sm border border-bordure-2"
                style={{ backgroundColor: "var(--surface-3)" }}
              />
              Sans
            </li>
          </ul>

          <div className="h-[240px] w-full sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={donnees}
                margin={{ top: 12, right: 8, bottom: 0, left: -20 }}
                barGap={2}
              >
                <CartesianGrid stroke="var(--grille)" vertical={false} />
                <XAxis
                  dataKey="perimetre"
                  tick={{ fill: "var(--attenue)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--grille)" }}
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
                  cursor={{ fill: "var(--surface-2)" }}
                />
                <Bar dataKey="avec" name="Avec" fill={couleurAvec} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList
                    dataKey="avec"
                    position="top"
                    fontSize={11}
                    fill="var(--attenue)"
                    formatter={(v: unknown) =>
                      typeof v === "number" ? v.toFixed(1).replace(".", ",") : ""
                    }
                  />
                </Bar>
                <Bar
                  dataKey="sans"
                  name="Sans"
                  fill="var(--surface-3)"
                  stroke="var(--bordure-2)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="sans"
                    position="top"
                    fontSize={11}
                    fill="var(--attenue)"
                    formatter={(v: unknown) =>
                      typeof v === "number" ? v.toFixed(1).replace(".", ",") : ""
                    }
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="mt-3 text-xs text-attenue">
            Un écart n&apos;est pas une cause : il dit que les journées{" "}
            {declencheur.libelle.toLowerCase()} ont été plus joyeuses, pas qu&apos;elles
            l&apos;ont été grâce à lui.
          </p>
        </>
      )}
    </Carte>
  );
}
