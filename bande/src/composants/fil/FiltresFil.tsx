"use client";

import { motion } from "motion/react";

import { Avatar } from "../Avatar";
import { RESSORT } from "@/lib/mouvement";
import type { FiltreFil, Profil } from "@/lib/types";

/**
 * Les filtres rapides du fil.
 *
 * Une seule ligne, qui défile horizontalement quand la bande est nombreuse.
 * Un seul filtre actif à la fois : des filtres qui se combinent demandent
 * qu'on se rappelle lequel est mis, et on ne se le rappelle jamais.
 *
 * L'onglet actif est marqué par un fond qui glisse d'une pilule à l'autre
 * (`layoutId`) plutôt que par un fond qui s'allume : c'est le même mouvement
 * que la barre d'onglets, et il dit d'où l'on vient.
 */
export function FiltresFil({
  valeur,
  profils,
  moi,
  onChange,
}: {
  valeur: FiltreFil;
  profils: Profil[];
  moi: string;
  onChange: (filtre: FiltreFil) => void;
}) {
  const cle = valeur.genre === "personne" ? `personne:${valeur.profil}` : valeur.genre;

  return (
    <div
      role="tablist"
      aria-label="Filtrer le fil"
      // Les marges négatives font défiler la rangée d'un bord à l'autre de
      // l'écran ; le rembourrage la remet dans la colonne de lecture.
      className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Pilule actif={cle === "tout"} onClick={() => onChange({ genre: "tout" })}>
        Tout
      </Pilule>
      <Pilule actif={cle === "photo"} onClick={() => onChange({ genre: "photo" })}>
        Photos
      </Pilule>
      <Pilule actif={cle === "vocal"} onClick={() => onChange({ genre: "vocal" })}>
        Vocaux
      </Pilule>
      {profils.map((profil) => (
        <Pilule
          key={profil.id}
          actif={cle === `personne:${profil.id}`}
          onClick={() => onChange({ genre: "personne", profil: profil.id })}
        >
          <Avatar profil={profil} taille={20} />
          {profil.id === moi ? "Moi" : profil.pseudo}
        </Pilule>
      ))}
    </div>
  );
}

function Pilule({
  actif,
  onClick,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={actif}
      onClick={onClick}
      className={`cible-tactile relative inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-pilule)] px-3.5 py-2 text-[13px] font-medium transition ${
        actif ? "text-encre" : "text-encre-3 hover:text-encre-2"
      }`}
    >
      {actif && (
        <motion.span
          layoutId="filtre-actif"
          transition={RESSORT.vif}
          aria-hidden
          className="absolute inset-0 rounded-[var(--radius-pilule)] border border-trait bg-surface-2"
        />
      )}
      <span className="relative inline-flex items-center gap-1.5">{children}</span>
    </button>
  );
}
