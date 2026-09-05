"use client";

import { motion } from "motion/react";
import { useState } from "react";

import { VisageJoie } from "./VisageJoie";
import { RESSORT } from "@/lib/mouvement";
import { couleurJoie, motJoie } from "@/lib/couleurs";

/**
 * Le check-in en moins de dix secondes.
 *
 * Un seul geste compte : faire glisser. Le visage et le nombre suivent le
 * doigt en temps réel, sans latence — c'est ce qui donne l'impression de
 * manipuler une matière plutôt que de remplir un formulaire.
 */
export function CurseurJoie({
  valeurInitiale = 7,
  onChange,
  nom,
}: {
  valeurInitiale?: number;
  onChange?: (valeur: number) => void;
  /** Donné, le curseur devient un champ de formulaire à part entière. */
  nom?: string;
}) {
  const [valeur, setValeur] = useState(valeurInitiale);

  function changer(nouvelle: number) {
    if (nouvelle === valeur) return;
    setValeur(nouvelle);
    onChange?.(nouvelle);
    // Un retour tactile bref à chaque cran : la valeur se sent autant qu'elle
    // se lit. `navigator.vibrate` n'existe pas sur iOS — et c'est justement là
    // que tourne la bande. Le test de présence suffit : pas de repli à
    // inventer, le curseur se manipule très bien sans vibration, et toute
    // bidouille pour la simuler ferait plus de dégâts que de bien.
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(8);
    }
  }

  const part = (valeur - 1) / 9;

  return (
    <div>
      <div className="flex items-center gap-5">
        <motion.div
          animate={{ scale: 1 + part * 0.08 }}
          transition={RESSORT.moyen}
        >
          <VisageJoie valeur={valeur} taille={84} />
        </motion.div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <motion.span
              key={valeur}
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={RESSORT.chiffre}
              className="chiffres text-[44px] leading-none"
              style={{ color: "var(--joie-encre)" }}
            >
              {valeur}
            </motion.span>
            <span className="text-sm text-encre-3">/ 10</span>
          </div>
          <p className="mt-1 text-sm text-encre-2 first-letter:uppercase">{motJoie(valeur)}</p>
        </div>
      </div>

      <div className="relative mt-5">
        <div className="h-2.5 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className="h-full rounded-full"
            style={{ background: couleurJoie(valeur) }}
            animate={{ width: `${part * 100}%` }}
            transition={RESSORT.moyen}
          />
        </div>
        <input
          type="range"
          name={nom}
          min={1}
          max={10}
          step={1}
          value={valeur}
          onChange={(e) => changer(Number(e.target.value))}
          aria-label="Niveau de joie"
          aria-valuetext={`${valeur} sur 10, ${motJoie(valeur)}`}
          className="curseur absolute inset-x-0 -top-3 h-8 w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>

      <div className="mt-2 flex justify-between px-0.5 text-[11px] text-encre-3">
        <span>1</span>
        <span>10</span>
      </div>

      <style>{`
        .curseur::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 30px;
          height: 30px;
          border-radius: 999px;
          background: var(--surface);
          border: 1px solid var(--trait-fort);
          box-shadow: var(--ombre-2);
          cursor: grab;
        }
        .curseur:active::-webkit-slider-thumb { cursor: grabbing; }
        .curseur::-moz-range-thumb {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          background: var(--surface);
          border: 1px solid var(--trait-fort);
          box-shadow: var(--ombre-2);
        }
      `}</style>
    </div>
  );
}
