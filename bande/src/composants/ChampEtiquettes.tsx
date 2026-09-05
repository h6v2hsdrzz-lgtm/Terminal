"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { RESSORT } from "@/lib/mouvement";
// La même normalisation qu'au serveur : sans elle, l'écran laisserait ajouter
// un doublon que la base refuserait ensuite de dédoubler.
import { LONGUEUR_ETIQUETTE, MAX_ETIQUETTES, cleEtiquette as cle, nettoyerEtiquette } from "@/lib/etiquettes";

/**
 * Les étiquettes d'une journée.
 *
 * Les déclencheurs sont fixes et décidés par la bande ; les étiquettes sont
 * libres et s'inventent au fil des mois. Les deux coexistent : « boulot » est
 * un déclencheur qu'on retrouve chaque semaine, « déménagement » est une
 * étiquette qui n'aura de sens que cette année-là.
 *
 * Ce qui part au serveur est un champ caché : une chaîne séparée par des
 * virgules. Ça garde le formulaire fonctionnel sans JavaScript — on tape
 * directement dans le champ visible, et il porte le même nom.
 */
export function ChampEtiquettes({
  proposees,
  initiales = [],
}: {
  /** Celles que la bande utilise déjà, les plus fréquentes d'abord. */
  proposees: { id: string; nom: string }[];
  initiales?: string[];
}) {
  const [choisies, setChoisies] = useState<string[]>(initiales);
  const [saisie, setSaisie] = useState("");
  const complet = choisies.length >= MAX_ETIQUETTES;

  function ajouter(nom: string) {
    const propre = nettoyerEtiquette(nom);
    if (!cle(propre) || complet) return;
    if (choisies.some((c) => cle(c) === cle(propre))) return;
    setChoisies([...choisies, propre]);
    setSaisie("");
  }

  function toucheAppuyee(evenement: React.KeyboardEvent<HTMLInputElement>) {
    // Entrée valide l'étiquette sans envoyer le formulaire — on est au milieu
    // de la saisie, pas au bout.
    if (evenement.key === "Enter" || evenement.key === ",") {
      evenement.preventDefault();
      ajouter(saisie);
    } else if (evenement.key === "Backspace" && saisie === "" && choisies.length > 0) {
      setChoisies(choisies.slice(0, -1));
    }
  }

  const restantes = proposees
    .filter((p) => !choisies.some((c) => cle(c) === cle(p.nom)))
    .filter((p) => (saisie ? cle(p.nom).includes(cle(saisie)) : true))
    .slice(0, 6);

  return (
    <div className="mt-4">
      <input type="hidden" name="etiquettes" value={choisies.join(",")} />

      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-trait bg-surface-2 px-2.5 py-2">
        <AnimatePresence initial={false}>
          {choisies.map((nom) => (
            <motion.button
              key={nom}
              type="button"
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={RESSORT.vif}
              onClick={() => setChoisies(choisies.filter((c) => c !== nom))}
              className="inline-flex items-center gap-1 rounded-[var(--radius-pilule)] bg-surface-3 px-2.5 py-1 text-[13px] text-encre-2"
            >
              {nom}
              <span aria-hidden className="text-encre-3">×</span>
              <span className="sr-only">retirer</span>
            </motion.button>
          ))}
        </AnimatePresence>

        <input
          type="text"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={toucheAppuyee}
          // Une étiquette tapée puis laissée en plan doit compter : personne
          // n'imagine devoir « valider » un mot avant d'envoyer.
          onBlur={() => ajouter(saisie)}
          maxLength={LONGUEUR_ETIQUETTE}
          disabled={complet}
          aria-label="Ajouter une étiquette"
          placeholder={choisies.length === 0 ? "Étiquettes… (facultatif)" : ""}
          // `champ-saisie` tient la taille à 16px : en dessous, Safari zoome sur
          // le champ à la mise au point et ne dézoome jamais.
          className="champ-saisie min-w-[7rem] flex-1 bg-transparent py-0.5 placeholder:text-encre-3 focus:outline-none"
        />
      </div>

      {restantes.length > 0 && !complet && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {restantes.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                // Sans ça, appuyer sur une proposition sort d'abord du champ,
                // ce qui pose le mot à moitié tapé, refiltre la liste, et fait
                // disparaître le bouton sous le doigt avant que le clic
                // n'arrive. Empêcher le comportement par défaut de `mousedown`
                // garde le champ actif : seul le clic agit.
                onMouseDown={(evenement) => evenement.preventDefault()}
                onClick={() => ajouter(p.nom)}
                className="rounded-[var(--radius-pilule)] border border-trait px-2.5 py-1 text-[13px] text-encre-3 transition hover:border-trait-fort hover:text-encre-2"
              >
                {p.nom}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
