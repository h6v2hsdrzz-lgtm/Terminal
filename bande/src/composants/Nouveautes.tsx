"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, useSyncExternalStore } from "react";

import { CLE_VUE, NOUVEAUTES, VERSION_COURANTE, type EcranNouveaute } from "@/lib/nouveautes";

/**
 * Les nouveautés, une fois par version.
 *
 * ## Pourquoi le navigateur et pas la base
 *
 * Parce que c'est un réglage sans conséquence : le pire qui puisse arriver,
 * c'est de revoir cinq écrans une deuxième fois sur un autre appareil. Une
 * colonne de plus en base, une migration et un aller-retour réseau pour ça,
 * c'est cher payé.
 *
 * ## Pourquoi `useSyncExternalStore` plutôt qu'un effet
 *
 * `localStorage` n'existe pas pendant le rendu serveur. Le lire dans un effet
 * pour poser un état, c'est un rendu de plus, une règle de lint enfreinte, et
 * surtout un éclair : le voile s'affiche puis disparaît. Le troisième argument
 * donne la réponse du serveur — « déjà vu », donc rien à l'écran — qui est
 * aussi celle du premier rendu client, donc aucune divergence d'hydratation.
 */
const abonnes = new Set<() => void>();

function sAbonner(rappel: () => void): () => void {
  abonnes.add(rappel);
  window.addEventListener("storage", rappel);
  return () => {
    abonnes.delete(rappel);
    window.removeEventListener("storage", rappel);
  };
}

function dejaVue(): boolean {
  try {
    return localStorage.getItem(CLE_VUE) === VERSION_COURANTE;
  } catch {
    // Navigation privée : on ne montrera rien plutôt que de le montrer à
    // chaque ouverture.
    return true;
  }
}

function marquerVue() {
  try {
    localStorage.setItem(CLE_VUE, VERSION_COURANTE);
  } catch {
    // Tant pis : ça se reverra une fois.
  }
  for (const rappel of abonnes) rappel();
}

export function Nouveautes() {
  const vue = useSyncExternalStore(sAbonner, dejaVue, () => true);
  if (vue) return null;
  return <FeuilleNouveautes ecrans={NOUVEAUTES[0].ecrans} fermer={marquerVue} />;
}

/**
 * Les écrans eux-mêmes, en plein cadre.
 *
 * Ils défilent **horizontalement au doigt** — `scroll-snap`, pas un carrousel
 * en JavaScript : le défilement natif d'iOS a l'inertie et le rebond, et
 * personne n'a jamais réussi à les réécrire de façon convaincante.
 */
function FeuilleNouveautes({
  ecrans,
  fermer,
}: {
  ecrans: EcranNouveaute[];
  fermer: () => void;
}) {
  const [rang, setRang] = useState(0);
  const dernier = rang >= ecrans.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Les nouveautés"
        className="fixed inset-0 z-[60] flex flex-col bg-surface"
      >
        <div
          onScroll={(evenement) => {
            const largeur = evenement.currentTarget.clientWidth || 1;
            setRang(Math.round(evenement.currentTarget.scrollLeft / largeur));
          }}
          className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {ecrans.map((ecran) => (
            <section
              key={ecran.titre}
              className="flex w-full shrink-0 snap-center flex-col items-center justify-center px-8 text-center"
            >
              <span aria-hidden className="text-[64px] leading-none">
                {ecran.emoji}
              </span>
              <h2 className="mt-6 text-[26px] font-semibold leading-tight tracking-[-0.02em]">
                {ecran.titre}
              </h2>
              <p className="mt-3 max-w-[22rem] text-[16px] leading-snug text-encre-2">
                {ecran.texte}
              </p>
            </section>
          ))}
        </div>

        <div className="zone-sure-basse px-6 pb-6">
          <div className="mb-5 flex justify-center gap-1.5" aria-hidden>
            {ecrans.map((ecran, i) => (
              <span
                key={ecran.titre}
                className={`h-1.5 rounded-full transition-all ${
                  i === rang ? "w-5 bg-encre" : "w-1.5 bg-trait-fort"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={fermer}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="cible-tactile w-full rounded-[var(--radius-pilule)] py-3.5 text-[16px] font-semibold"
          >
            {dernier ? "C'est parti" : "Passer"}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Les mêmes écrans, atteignables depuis les réglages quand on veut les revoir. */
export function NouveautesAuChoix() {
  const [ouvert, setOuvert] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="cible-tactile w-full rounded-[var(--radius-pilule)] border border-trait-fort bg-surface py-2.5 text-center text-[15px] font-medium transition hover:border-encre-3"
      >
        Revoir les nouveautés
      </button>
      {ouvert && <FeuilleNouveautes ecrans={NOUVEAUTES[0].ecrans} fermer={() => setOuvert(false)} />}
    </>
  );
}
