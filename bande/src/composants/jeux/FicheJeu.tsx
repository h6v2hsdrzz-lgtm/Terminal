"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Carte } from "@/composants/Carte";
import { Avatar } from "@/composants/Avatar";
import { actionLancerPartie, actionOuvrirSalon } from "@/lib/actions-jeux";
import type { Jeu } from "@/lib/jeux/catalogue";
import { RESSORT } from "@/lib/mouvement";
import type { Profil } from "@/lib/types";

/**
 * La fiche d'un jeu : le nom, la durée, trois lignes de règles, et le bouton.
 *
 * Les règles sont **repliées mais complètes** : dépliées d'office, dix fiches
 * feraient une page de trois écrans que personne ne parcourt ; cachées derrière
 * une autre page, elles ne seraient pas lues du tout.
 *
 * Le choix des joueurs est ici, pas dans un écran de plus. À trois, la question
 * est « qui joue » et « qui conduit », et les deux tiennent en une ligne
 * chacune.
 */
export function FicheJeu({
  jeu,
  profils,
  moiId,
  bloque,
}: {
  jeu: Jeu;
  profils: Profil[];
  moiId: string;
  bloque: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [joueurs, setJoueurs] = useState<string[]>(profils.map((p) => p.id));
  const [sobres, setSobres] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const router = useRouter();

  function basculer(liste: string[], id: string) {
    return liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id];
  }

  /**
   * Deux façons de lancer, et la première est celle par défaut.
   *
   * **Chacun son téléphone** ouvre un salon : les autres reçoivent un bandeau
   * sur leur accueil, ou tapent le code. C'est le mode normal depuis le lot N —
   * on est trois avec l'application installée, se passer l'appareil n'a plus
   * de raison d'être.
   *
   * **Un seul téléphone** reste là pour dépanner : une batterie à plat, un
   * invité sans l'application. Il démarre directement, sans salon : il n'y a
   * personne à attendre, l'appareil est déjà dans la main.
   */
  function lancer(mode: "multi" | "un-telephone") {
    setErreur(null);
    demarrer(async () => {
      const reponse =
        mode === "multi"
          ? await actionOuvrirSalon(jeu.cle)
          : await actionLancerPartie(
              jeu.cle,
              joueurs.map((membreId) => ({ membreId, sobre: sobres.includes(membreId) })),
            );
      if (reponse.erreur || !reponse.valeur) {
        setErreur(reponse.erreur ?? "La partie n'a pas démarré.");
        return;
      }
      router.push(`/jeux/${reponse.valeur}`);
    });
  }

  return (
    <Carte className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOuvert(!ouvert)}
        aria-expanded={ouvert}
        className="cible-tactile flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span aria-hidden className="text-[22px]">{jeu.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold tracking-tight">{jeu.nom}</span>
          <span className="block text-[13px] text-encre-3">
            {jeu.duree} min{jeu.boit ? " · à la gorgée" : ""}
          </span>
        </span>
        <motion.span
          aria-hidden
          animate={{ rotate: ouvert ? 90 : 0 }}
          transition={RESSORT.vif}
          className="text-encre-3"
        >
          ›
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {ouvert && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={RESSORT.moyen}
            className="overflow-hidden"
          >
            <div className="border-t border-trait px-4 py-3.5">
              <ol className="space-y-1.5">
                {jeu.regles.map((regle, i) => (
                  <li key={regle} className="flex gap-2.5 text-[14px] leading-snug text-encre-2">
                    <span aria-hidden className="text-encre-3">{i + 1}.</span>
                    <span>{regle}</span>
                  </li>
                ))}
              </ol>

              <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
                Qui joue
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {profils.map((profil) => {
                  const dedans = joueurs.includes(profil.id);
                  return (
                    <li key={profil.id}>
                      <button
                        type="button"
                        onClick={() => setJoueurs(basculer(joueurs, profil.id))}
                        aria-pressed={dedans}
                        className={`cible-tactile flex items-center gap-2 rounded-[var(--radius-pilule)] border px-2.5 py-1.5 text-[14px] ${
                          dedans
                            ? "border-transparent bg-surface-3 text-encre"
                            : "border-trait text-encre-3"
                        }`}
                      >
                        <Avatar profil={profil} taille={22} />
                        {profil.pseudo}
                        {profil.id === moiId && <span className="text-encre-3">(toi)</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {jeu.boit && (
                <>
                  <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
                    Qui conduit
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-encre-3">
                    Celui qui conduit reçoit un gage à la place de chaque gorgée. Ce
                    n&apos;est pas un lot de consolation : c&apos;est le même tour, autrement.
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {profils
                      .filter((p) => joueurs.includes(p.id))
                      .map((profil) => {
                        const sobre = sobres.includes(profil.id);
                        return (
                          <li key={profil.id}>
                            <button
                              type="button"
                              onClick={() => setSobres(basculer(sobres, profil.id))}
                              aria-pressed={sobre}
                              className={`cible-tactile rounded-[var(--radius-pilule)] border px-2.5 py-1.5 text-[14px] ${
                                sobre
                                  ? "border-transparent bg-surface-3 text-encre"
                                  : "border-trait text-encre-3"
                              }`}
                            >
                              {profil.pseudo}
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </>
              )}

              {erreur && (
                <p role="alert" className="mt-3 text-[14px] text-[var(--alerte)]">
                  {erreur}
                </p>
              )}
              {bloque && (
                <p className="mt-3 text-[13px] text-encre-3">
                  Une partie est déjà en cours. Finis-la ou abandonne-la d&apos;abord.
                </p>
              )}

              <button
                type="button"
                onClick={() => lancer("multi")}
                disabled={bloque || enCours}
                className="cible-tactile mt-4 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface disabled:opacity-40"
              >
                {enCours ? "Un instant…" : "Chacun son téléphone"}
              </button>
              <p className="mt-2 text-center text-[13px] text-encre-3">
                Les autres reçoivent un bandeau sur leur accueil, ou tapent le code.
              </p>

              {/* Le mode de secours, en dessous et en plus petit : il dépanne,
                  il n'est plus la façon normale de jouer. */}
              <button
                type="button"
                onClick={() => lancer("un-telephone")}
                disabled={bloque || enCours || joueurs.length < 2}
                className="cible-tactile mt-3 w-full py-2.5 text-center text-[14px] text-encre-3 underline underline-offset-2 transition hover:text-encre-2 disabled:opacity-40"
              >
                Un seul téléphone, on se le passe
              </button>
              {joueurs.length < 2 && (
                <p className="mt-1 text-center text-[13px] text-encre-3">
                  Ce mode-là demande d&apos;être au moins deux.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Carte>
  );
}
