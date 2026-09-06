"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Avatar } from "@/composants/Avatar";
import type { Moteur } from "./CoquilleJeu";
import { PasseLeTelephone } from "./PasseLeTelephone";
import { sanction } from "@/lib/jeux/cadre";
import { NIVEAUX_JAMAIS, affirmations, type Niveau } from "@/lib/jeux/contenu/jamais";
import { generateur, pioche } from "@/lib/jeux/tirage";
import { RESSORT } from "@/lib/mouvement";

/**
 * « Je n'ai jamais ».
 *
 * Le niveau se choisit au début et se change en cours de partie : une soirée
 * qui monte d'un cran doit le faire parce que quelqu'un l'a demandé, jamais
 * parce que l'application a décidé toute seule que c'était le moment.
 *
 * Personne ne marque de point. C'est voulu — compter les aveux transformerait
 * la partie en concours de qui a la vie la plus sale, et le podium le dit
 * franchement à la fin.
 */
type Phase = "reglage" | "annonce" | "vote" | "resultat";

export function JeuJamais({ moteur }: { moteur: Moteur }) {
  const [niveaux, setNiveaux] = useState<Niveau[]>(["soft"]);
  const [phase, setPhase] = useState<Phase>("reglage");
  const [carte, setCarte] = useState("");
  const [aveux, setAveux] = useState<Record<string, string>>({});
  const [graine] = useState(() => Math.floor(Math.random() * 2 ** 31));

  /**
   * La pioche vit dans une référence, pas dans un `useMemo` : elle a une
   * mémoire — ne pas redonner la même affirmation avant la fin du paquet — et
   * React a le droit de jeter un `useMemo` quand il veut. Elle est reconstruite
   * quand le niveau change, seul moment où le paquet n'est plus le même.
   */
  const paquet = useRef<ReturnType<typeof pioche<string>> | null>(null);
  const niveauxPris = useRef<string>("");

  const tirer = useCallback(() => {
    const signature = niveaux.join(",");
    if (!paquet.current || niveauxPris.current !== signature) {
      paquet.current = pioche(affirmations(niveaux), generateur(graine));
      niveauxPris.current = signature;
    }
    setCarte(paquet.current.suivante());
    setAveux({});
    setPhase("annonce");
  }, [niveaux, graine]);

  function basculerNiveau(niveau: Niveau) {
    setNiveaux((avant) =>
      avant.includes(niveau)
        ? avant.length > 1
          ? avant.filter((n) => n !== niveau)
          : avant
        : [...avant, niveau],
    );
  }

  if (phase === "reglage") {
    return (
      <div className="px-4 py-8">
        <h2 className="text-[22px] font-semibold tracking-tight">Jusqu&apos;où on va ?</h2>
        <p className="mt-1.5 text-[14px] leading-snug text-encre-2">
          Le niveau se change quand vous voulez, y compris en pleine partie.
          Personne ne le monte à votre place.
        </p>
        <ul className="mt-5 space-y-2.5">
          {NIVEAUX_JAMAIS.map((niveau) => {
            const pris = niveaux.includes(niveau.cle);
            return (
              <li key={niveau.cle}>
                <button
                  type="button"
                  onClick={() => basculerNiveau(niveau.cle)}
                  aria-pressed={pris}
                  className={`cible-tactile w-full rounded-[var(--radius-carte)] border px-4 py-3 text-left ${
                    pris ? "border-transparent bg-surface-3" : "border-trait"
                  }`}
                >
                  <span className="block text-[16px] font-semibold">{niveau.nom}</span>
                  <span className="block text-[13px] text-encre-3">{niveau.sous}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={tirer}
          className="cible-tactile mt-6 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
        >
          C&apos;est parti
        </button>
      </div>
    );
  }

  if (phase === "vote") {
    return (
      <PasseLeTelephone
        joueurs={moteur.joueurs}
        question={`« Je n'ai jamais ${carte}. »`}
        rendre={(_joueur, valider) => (
          <div className="mt-2 grid gap-2.5">
            <button
              type="button"
              onClick={() => valider("oui")}
              className="cible-tactile rounded-[var(--radius-carte)] bg-surface-3 px-4 py-5 text-[17px] font-semibold"
            >
              Si, moi si
            </button>
            <button
              type="button"
              onClick={() => valider("non")}
              className="cible-tactile rounded-[var(--radius-carte)] border border-trait px-4 py-5 text-[17px]"
            >
              Jamais
            </button>
            <button
              type="button"
              onClick={() => valider("passe")}
              className="cible-tactile rounded-[var(--radius-pilule)] px-4 py-3 text-[15px] text-encre-3"
            >
              Je passe
            </button>
          </div>
        )}
        surFin={(choix) => {
          setAveux(choix);
          moteur.manche({ jeu: "jamais", carte, aveux: choix });
          setPhase("resultat");
        }}
      />
    );
  }

  if (phase === "resultat") {
    return (
      <div className="px-4 py-8">
        <p className="text-[15px] text-encre-3">« Je n&apos;ai jamais {carte}. »</p>
        <ul className="mt-5 space-y-2.5">
          {moteur.joueurs.map((joueur) => {
            const reponse = aveux[joueur.membreId];
            const doit = sanction({
              sobre: joueur.sobre,
              nombre: reponse === "oui" ? 1 : 0,
              // Le gage dépend du joueur et de la carte, donc il change à chaque
              // tour sans qu'on ait à ranger un compteur quelque part.
              tirage: joueur.membreId.length + carte.length,
            });
            return (
              <li key={joueur.membreId} className="flex items-start gap-3">
                <Avatar
                  profil={{
                    id: joueur.membreId,
                    pseudo: joueur.pseudo,
                    teinte: joueur.teinte,
                    initiales: joueur.initiales,
                    avatar: joueur.avatar,
                  }}
                  taille={32}
                  attenue={reponse !== "oui"}
                />
                <span className="min-w-0 flex-1 pt-1">
                  <span className="block text-[15px] font-semibold">{joueur.pseudo}</span>
                  <span className="block text-[14px] leading-snug text-encre-2">
                    {reponse === "passe"
                      ? "passe son tour — et ça ne coûte rien"
                      : doit.genre === "gorgees"
                        ? doit.texte
                        : doit.genre === "gage"
                          ? doit.texte
                          : "s'en sort"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={tirer}
          className="cible-tactile mt-7 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
        >
          Suivante
        </button>
        <button
          type="button"
          onClick={() => setPhase("reglage")}
          className="cible-tactile mt-2 w-full rounded-[var(--radius-pilule)] px-4 py-2.5 text-[14px] text-encre-3"
        >
          Changer de niveau
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[62dvh] items-center px-6">
      <AnimatePresence mode="wait">
        <motion.div
          key={carte}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -14 }}
          transition={RESSORT.moyen}
          className="w-full"
        >
          <p className="text-[15px] uppercase tracking-[0.1em] text-encre-3">Je n&apos;ai jamais</p>
          <p className="mt-3 text-[28px] font-semibold leading-tight tracking-tight">{carte}</p>
          <button
            type="button"
            onClick={() => setPhase("vote")}
            className="cible-tactile mt-8 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
          >
            Chacun répond
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
