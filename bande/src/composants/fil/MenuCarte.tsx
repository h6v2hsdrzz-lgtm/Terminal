"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";

import { actionEpingler, actionReagir, actionRetirerJournee } from "@/lib/actions";
import { RESSORT } from "@/lib/mouvement";
import { partagerJournee } from "@/lib/partage";
import type { Annuaire, Entree } from "@/lib/types";

/**
 * L'appui long sur une carte du fil.
 *
 * Cinq gestes qui, sinon, demandent chacun un bouton permanent sur la carte :
 * réagir, commenter, partager en image, épingler, retirer. Une carte de fil
 * couverte de boutons n'est plus une carte, c'est une barre d'outils.
 *
 * Trois pièges d'iOS, tous rencontrés :
 *
 * · **le menu système de Safari.** Un appui long sur du texte ou une image
 *   lance la loupe, la sélection ou l'aperçu du lien. On les coupe en CSS
 *   (`touch-callout`, `user-select`) sur la carte, et on annule l'événement
 *   `contextmenu` — sans quoi les deux menus s'ouvrent l'un sur l'autre ;
 * · **le défilement.** Le doigt qui glisse doit annuler l'appui : sinon on
 *   ouvre un menu chaque fois qu'on fait défiler le fil. Dix pixels suffisent
 *   à faire la différence entre tenir et glisser ;
 * · **`navigator.vibrate` n'existe pas sur iOS.** On l'appelle quand même —
 *   c'est gratuit sur Android — mais le menu ne doit rien attendre de lui.
 */
const DELAI_MS = 480;
const TOLERANCE_PX = 10;
const EMOJIS = ["❤️", "😂", "🔥", "🫂", "🙌", "👀"];

export function MenuCarte({
  entree,
  annuaire,
  moi,
  bande,
  actif,
  children,
}: {
  entree: Entree;
  annuaire: Annuaire;
  moi: string;
  /** Le nom de la bande, écrit en haut de l'image de partage. */
  bande: string;
  actif: boolean;
  children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const depart = useRef<{ x: number; y: number } | null>(null);

  const annuler = useCallback(() => {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
    depart.current = null;
  }, []);

  useEffect(() => annuler, [annuler]);

  function commencer(e: React.PointerEvent) {
    if (!actif || e.pointerType === "mouse") return;
    depart.current = { x: e.clientX, y: e.clientY };
    minuteur.current = setTimeout(() => {
      if ("vibrate" in navigator) navigator.vibrate(18);
      setOuvert(true);
      annuler();
    }, DELAI_MS);
  }

  function bouger(e: React.PointerEvent) {
    if (!depart.current) return;
    const loin =
      Math.abs(e.clientX - depart.current.x) > TOLERANCE_PX ||
      Math.abs(e.clientY - depart.current.y) > TOLERANCE_PX;
    if (loin) annuler();
  }

  return (
    <>
      <div
        // La cible de l'appui long, nommée : c'est le seul élément du fil que
        // les tests doivent viser, et deviner un sélecteur de mise en page
        // les casse au premier changement de marge.
        data-carte={entree.id}
        onPointerDown={commencer}
        onPointerMove={bouger}
        onPointerUp={annuler}
        onPointerCancel={annuler}
        onContextMenu={(e) => {
          if (actif) e.preventDefault();
        }}
        className={actif ? "[-webkit-touch-callout:none] select-none" : undefined}
      >
        {children}
      </div>

      <AnimatePresence>
        {ouvert && (
          <FeuilleMenu
            entree={entree}
            annuaire={annuaire}
            moi={moi}
            bande={bande}
            fermer={() => setOuvert(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function FeuilleMenu({
  entree,
  annuaire,
  moi,
  bande,
  fermer,
}: {
  entree: Entree;
  annuaire: Annuaire;
  moi: string;
  bande: string;
  fermer: () => void;
}) {
  const [enCours, demarrer] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmeRetrait, setConfirmeRetrait] = useState(false);
  const profil = annuaire.profils.find((p) => p.id === entree.profil);

  // Échap ferme la feuille : elle est modale, et une modale sans sortie au
  // clavier est une modale cassée sur un ordinateur.
  useEffect(() => {
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === "Escape") fermer();
    };
    document.addEventListener("keydown", auClavier);
    return () => document.removeEventListener("keydown", auClavier);
  }, [fermer]);

  function reagir(emoji: string) {
    demarrer(async () => {
      await actionReagir(entree.id, emoji);
      fermer();
    });
  }

  function partager() {
    if (!profil) return;
    demarrer(async () => {
      try {
        const sortie = await partagerJournee({ entree, profil, bande });
        if (sortie === "telechargement") setMessage("Image enregistrée.");
        else fermer();
      } catch {
        setMessage("L'image n'a pas pu être fabriquée sur ce téléphone.");
      }
    });
  }

  return (
    <>
      <motion.button
        type="button"
        aria-label="Fermer le menu"
        onClick={fermer}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40"
        style={{ background: "rgb(0 0 0 / .45)" }}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`Actions sur la journée de ${profil?.pseudo ?? "quelqu'un"}`}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={RESSORT.ample}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg rounded-t-[var(--radius-feuille)] border border-trait bg-surface pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 shadow-[var(--ombre-3)]"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-trait-fort" />

        <div className="flex justify-between gap-1 px-4 pb-3">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              disabled={enCours}
              onClick={() => reagir(emoji)}
              className="grid h-12 w-12 place-items-center rounded-2xl text-[26px] transition active:scale-90 disabled:opacity-40"
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="border-t border-trait">
          <Ligne
            onClick={() => {
              fermer();
              // Le champ de commentaire vit dans le pied de la carte : plutôt
              // que de le dupliquer ici, on l'ouvre là où il est.
              document.getElementById(`c-${entree.id}`)?.focus();
              document
                .getElementById(`c-${entree.id}`)
                ?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
            icone="💬"
          >
            Commenter
          </Ligne>
          <Ligne onClick={partager} icone="🖼️" occupe={enCours}>
            Partager en image
          </Ligne>
          <Ligne
            icone={entree.epingle ? "📌" : "📍"}
            occupe={enCours}
            onClick={() =>
              demarrer(async () => {
                await actionEpingler(entree.id);
                fermer();
              })
            }
          >
            {entree.epingle ? "Décrocher" : "Épingler en haut"}
          </Ligne>

          {/* Le droit de retrait : sans justification, et sans détour. Il ne
              s'affiche que sur sa propre journée — une journée ne vise que
              celui qui l'a écrite. */}
          {entree.profil === moi &&
            (confirmeRetrait ? (
              <Ligne
                icone="🗑️"
                danger
                occupe={enCours}
                onClick={() =>
                  demarrer(async () => {
                    await actionRetirerJournee(entree.id);
                    fermer();
                  })
                }
              >
                Confirmer — cette journée part pour de bon
              </Ligne>
            ) : (
              <Ligne icone="🗑️" danger onClick={() => setConfirmeRetrait(true)}>
                Retirer ma journée
              </Ligne>
            ))}
        </div>

        {message && (
          <p role="status" className="px-5 pt-3 text-[13px] text-encre-3">
            {message}
          </p>
        )}
      </motion.div>
    </>
  );
}

function Ligne({
  icone,
  children,
  onClick,
  danger = false,
  occupe = false,
}: {
  icone: string;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  occupe?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={occupe}
      className={`flex w-full items-center gap-3 px-5 py-3.5 text-left text-[15px] transition active:bg-surface-2 disabled:opacity-40 ${
        danger ? "text-encre-2" : "text-encre"
      }`}
    >
      <span aria-hidden className="text-[18px]">
        {icone}
      </span>
      {children}
    </button>
  );
}
