"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";

import { actionAjouterCarte, actionRetirerCarte } from "@/lib/actions-jeux";
import { LONGUEUR_CARTE, type CarteMaison } from "@/lib/jeux/types";
import { RESSORT } from "@/lib/mouvement";

/**
 * « Nos potes » : le seul paquet que la bande écrit.
 *
 * Il est là, dans le choix du paquet, et pas dans un écran de réglages : on
 * ajoute une carte au moment où l'on constate qu'elle manque, c'est-à-dire
 * juste avant de jouer. Un formulaire rangé ailleurs ne serait jamais ouvert.
 *
 * **N'importe qui peut retirer n'importe quelle carte**, sans se justifier et
 * sans que ça prévienne personne. C'est le droit de retrait du plan, et il est
 * prioritaire sur le reste : une carte qui fait deviner un pote est exactement
 * le genre de contenu qu'il doit pouvoir faire disparaître d'un geste.
 */
export function PaquetDeLaBande({
  cartes,
  surChangement,
}: {
  cartes: CarteMaison[];
  surChangement: (cartes: CarteMaison[]) => void;
}) {
  const [saisie, setSaisie] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function ajouter() {
    const texte = saisie.trim();
    if (!texte) return;
    setErreur(null);
    demarrer(async () => {
      const reponse = await actionAjouterCarte("potes", texte);
      if (reponse.erreur || !reponse.valeur) {
        setErreur(reponse.erreur ?? "La carte n'a pas été ajoutée.");
        return;
      }
      setSaisie("");
      // On range la ligne rendue par le serveur, avec son vrai identifiant :
      // un identifiant inventé ici rendrait la suppression suivante inopérante.
      surChangement([reponse.valeur, ...cartes]);
    });
  }

  function retirer(carte: CarteMaison) {
    surChangement(cartes.filter((c) => c.id !== carte.id));
    demarrer(async () => {
      const reponse = await actionRetirerCarte(carte.id);
      // Si le serveur refuse, la carte revient : un retrait qui n'a pas eu lieu
      // ne doit pas rester effacé à l'écran.
      if (reponse.erreur) {
        setErreur(reponse.erreur);
        surChangement(cartes);
      }
    });
  }

  return (
    <div className="mt-4 rounded-[var(--radius-carte)] border border-trait p-3.5">
      <p className="text-[15px] font-semibold">👥 Nos potes</p>
      <p className="mt-1 text-[13px] leading-snug text-encre-3">
        Vos noms à vous : les potes, les ex, le voisin, la prof de troisième.
        N&apos;importe qui peut en retirer une, sans avoir à s&apos;expliquer.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              ajouter();
            }
          }}
          maxLength={LONGUEUR_CARTE}
          placeholder="Un nom, un surnom…"
          aria-label="Ajouter une carte au paquet Nos potes"
          className="champ-saisie min-w-0 flex-1 rounded-[var(--radius-pilule)] border border-trait bg-surface-2 px-3.5 py-2.5"
        />
        <button
          type="button"
          onClick={ajouter}
          disabled={enCours || saisie.trim().length < 2}
          className="cible-tactile rounded-[var(--radius-pilule)] bg-surface-3 px-4 py-2.5 text-[15px] font-semibold disabled:opacity-40"
        >
          Ajouter
        </button>
      </div>
      {erreur && (
        <p role="alert" className="mt-2 text-[13px] text-[var(--alerte)]">
          {erreur}
        </p>
      )}

      {cartes.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {cartes.map((carte) => (
              <motion.li
                key={carte.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={RESSORT.vif}
              >
                <button
                  type="button"
                  onClick={() => retirer(carte)}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-pilule)] bg-surface-3 px-2.5 py-1 text-[13px] text-encre-2"
                >
                  {carte.texte}
                  <span aria-hidden className="text-encre-3">×</span>
                  <span className="sr-only">retirer</span>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {cartes.length < 5 && (
        <p className="mt-3 text-[13px] text-encre-3">
          En dessous de cinq cartes, le paquet tourne trop vite pour être drôle.
        </p>
      )}
    </div>
  );
}
