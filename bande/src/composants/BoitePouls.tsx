"use client";

import { useState, useTransition } from "react";
import { motion } from "motion/react";

import { actionPoserPouls } from "@/lib/actions";
import { MAX, MIN } from "@/lib/pouls";
import { RESSORT } from "@/lib/mouvement";

/**
 * Le pouls : deux curseurs, deux taps, aucun texte.
 *
 * Le check-in complet reste une fois par jour — c'est le rituel, et le diluer
 * le tuerait. Le pouls est autre chose : on le pose au réveil, après le
 * déjeuner, en sortant du boulot, autant de fois qu'on veut. Il existe parce
 * qu'un graphique de la journée en cours n'a rien à tracer quand chacun ne
 * pose qu'un point.
 *
 * Il n'y a **pas de bouton d'envoi séparé** : deux curseurs et « poser », et
 * c'est fini. Un formulaire de trois champs pour un geste de cinq secondes,
 * personne ne le fait deux fois.
 */
export function BoitePouls({ dernier }: { dernier: { rire: number; energie: number } | null }) {
  const [rire, setRire] = useState(dernier?.rire ?? 6);
  const [energie, setEnergie] = useState(dernier?.energie ?? 6);
  const [pose, setPose] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function poser() {
    setErreur(null);
    demarrer(async () => {
      const etat = await actionPoserPouls(rire, energie);
      if (etat.erreur) {
        setErreur(etat.erreur);
        return;
      }
      setPose(true);
      // Le retour au repos : on peut en reposer un plus tard dans la journée,
      // et laisser la confirmation à l'écran donnerait l'impression que c'est
      // fini pour aujourd'hui.
      setTimeout(() => setPose(false), 2200);
      if ("vibrate" in navigator) navigator.vibrate(14);
    });
  }

  return (
    <div className="space-y-3">
      <Curseur libelle="Rire" valeur={rire} surChangement={setRire} />
      <Curseur libelle="Énergie" valeur={energie} surChangement={setEnergie} />

      <motion.button
        type="button"
        onClick={poser}
        disabled={enCours}
        whileTap={{ scale: 0.98 }}
        transition={RESSORT.vif}
        className="cible-tactile w-full rounded-[var(--radius-pilule)] bg-surface-3 px-4 py-2.5 text-[14px] font-semibold disabled:opacity-50"
      >
        {pose ? "Posé ✓" : enCours ? "…" : "Poser un pouls"}
      </motion.button>
      {erreur && (
        <p role="alert" className="text-[13px] text-[var(--alerte)]">
          {erreur}
        </p>
      )}
    </div>
  );
}

/**
 * Un curseur, avec sa valeur lisible à côté.
 *
 * `accent-color` plutôt qu'un curseur redessiné : le natif a les bonnes zones
 * tactiles sur iOS, il suit les réglages d'accessibilité, et il fonctionne au
 * clavier sans qu'on ait à s'en occuper.
 */
function Curseur({
  libelle,
  valeur,
  surChangement,
}: {
  libelle: string;
  valeur: number;
  surChangement: (valeur: number) => void;
}) {
  const id = `pouls-${libelle.toLowerCase()}`;
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-[52px] shrink-0 text-[13px] text-encre-2">
        {libelle}
      </label>
      <input
        id={id}
        type="range"
        min={MIN}
        max={MAX}
        step={1}
        value={valeur}
        onChange={(e) => surChangement(Number(e.target.value))}
        className="h-6 min-w-0 flex-1"
        style={{ accentColor: "var(--joie-encre)" }}
      />
      <span className="chiffres w-[22px] shrink-0 text-right text-[14px] text-encre-2">
        {valeur}
      </span>
    </div>
  );
}
