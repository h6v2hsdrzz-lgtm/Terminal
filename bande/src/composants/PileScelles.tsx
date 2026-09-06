"use client";

import Link from "next/link";
import { useState } from "react";

import { Carte } from "./Carte";
import { Sablier } from "./Scelles";
import { decompte, nomDuGenre } from "@/lib/scelle";
import type { Capsule } from "@/lib/depot";

/**
 * Les scellés en attente, dans le fil, sans lui prendre sa place.
 *
 * Au-delà de deux, on n'affiche plus une ligne par scellé : une seule bulle
 * empilée, avec les prochains à s'ouvrir et le reste en nombre. L'espace
 * vertical du fil est précieux — c'est là qu'on vient lire les journées, pas
 * inventorier des promesses.
 *
 * Au toucher, la pile se déploie.
 */
const REPLIES = 2;

export function PileScelles({
  capsules,
  aujourdhui,
}: {
  capsules: Capsule[];
  aujourdhui: string;
}) {
  const [deployee, setDeployee] = useState(false);
  const scellees = capsules
    .filter((c) => c.ouvrirLe > aujourdhui)
    .sort((a, b) => a.ouvrirLe.localeCompare(b.ouvrirLe));

  if (scellees.length === 0) return null;

  if (scellees.length <= REPLIES || deployee) {
    return (
      <div className="mb-6 space-y-2">
        {scellees.map((c) => (
          <Sablier key={c.id} capsule={c} aujourdhui={aujourdhui} />
        ))}
        {deployee && (
          <button
            type="button"
            onClick={() => setDeployee(false)}
            className="w-full text-center text-[13px] text-encre-3 underline underline-offset-2"
          >
            replier
          </button>
        )}
      </div>
    );
  }

  const prochain = scellees[0];
  const reste = scellees.length - 1;

  return (
    <button type="button" onClick={() => setDeployee(true)} className="mb-6 block w-full text-left">
      <Carte className="relative flex items-center gap-3 p-3">
        {/* L'empilement se voit : deux cartes décalées derrière celle du
            dessus. C'est ce qui dit « il y en a d'autres » sans une ligne de
            texte de plus. */}
        <span
          aria-hidden
          className="absolute inset-x-3 -bottom-1 h-2 rounded-b-[var(--radius-carte)] border border-t-0 border-trait bg-surface"
        />
        <span
          aria-hidden
          className="absolute inset-x-5 -bottom-2 h-2 rounded-b-[var(--radius-carte)] border border-t-0 border-trait bg-surface-2"
        />
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-[18px]">
          ⏳
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">
            {scellees.length} scellés en attente
          </p>
          <p className="truncate text-[13px] text-encre-3">
            Le prochain, {nomDuGenre(prochain.genre)}, s&apos;ouvre{" "}
            {decompte(prochain.ouvrirLe, aujourdhui)} · et {reste}{" "}
            {reste > 1 ? "autres" : "autre"}
          </p>
        </div>
        <span aria-hidden className="shrink-0 text-encre-3">↓</span>
      </Carte>
    </button>
  );
}

/** L'entrée discrète du check-in : sceller quelque chose depuis Aujourd'hui. */
export function LienSceller() {
  return (
    <Link
      href="/souvenirs#scelles"
      className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-encre-3 underline underline-offset-2 hover:text-encre-2"
    >
      <span aria-hidden>⏳</span> sceller quelque chose pour plus tard
    </Link>
  );
}
