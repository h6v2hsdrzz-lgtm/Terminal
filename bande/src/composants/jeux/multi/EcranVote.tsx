"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Avatar } from "../../Avatar";
import { gorgees } from "@/lib/jeux/cadre";
import { RESSORT } from "@/lib/mouvement";

import type { MoteurMulti } from "./CoquilleMulti";
import { PHASES, reponsesDe } from "./protocole";

/**
 * Tout le monde répond en même temps, puis on révèle ensemble.
 *
 * C'est la forme la plus fréquente — six jeux sur dix — et celle où le multi
 * change le plus les choses : à un seul téléphone, il fallait se le passer et
 * cacher l'écran, ce qui prenait plus de temps que le jeu lui-même.
 *
 * **On ne montre jamais qui a répondu quoi avant la révélation**, seulement
 * QUI a répondu. Voir un vote en avance, c'est pouvoir s'aligner dessus, et le
 * jeu ne vaut plus rien.
 */
export function EcranVote({ moteur }: { moteur: MoteurMulti }) {
  const { etat, recette, joueurs, moi } = moteur;
  const [brouillon, setBrouillon] = useState<string[]>(["", "", ""]);

  const revelation = etat.phase === PHASES.revelation;
  const reponses = reponsesDe(etat, revelation ? PHASES.question : (etat.phase ?? ""));
  const maReponse = reponses.find((r) => r.membreId === moi);
  const options = recette.options(etat.donneesPhase, joueurs, moi);
  const libre = options.length === 0;

  return (
    <div className="flex min-h-[70dvh] flex-col justify-between px-4 py-6">
      {/* `data-enonce` : l'énoncé est la seule chose qu'un test ait besoin de
          viser sur cet écran, et le viser par son texte revient à attraper le
          conteneur au-dessus — émoji et titre du jeu compris. Même raison que
          `data-carte` dans le fil. */}
      <p
        data-enonce
        className="text-[22px] font-semibold leading-tight tracking-[-0.01em]"
      >
        {recette.enonce(etat.donneesPhase)}
      </p>

      <div className="py-6">
        <AnimatePresence mode="wait">
          {revelation ? (
            <motion.div
              key="revelation"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={RESSORT.moyen}
            >
              <p className="text-[19px] font-semibold leading-snug">
                {String(etat.donneesPhase.verdict ?? "")}
              </p>

              <ul className="mt-4 space-y-2">
                {joueurs.map((joueur) => {
                  const sienne = reponses.find((r) => r.membreId === joueur.membreId);
                  const boit = (
                    (etat.donneesPhase.gorgees as { membreId: string; nombre: number }[]) ?? []
                  ).find((g) => g.membreId === joueur.membreId);
                  const dit =
                    typeof sienne?.donnees.choix === "string"
                      ? (options.find((o) => o.cle === sienne.donnees.choix)?.libelle ??
                        String(sienne.donnees.choix))
                      : Array.isArray(sienne?.donnees.liste)
                        ? (sienne.donnees.liste as string[]).join(" · ")
                        : "—";
                  return (
                    <li key={joueur.membreId} className="flex items-center gap-3">
                      <Avatar
                        profil={{
                          id: joueur.membreId,
                          pseudo: joueur.pseudo,
                          teinte: joueur.teinte,
                          initiales: joueur.initiales,
                          avatar: joueur.avatar,
                        }}
                        taille={28}
                      />
                      <span className="min-w-0 flex-1 truncate text-[14px]">{dit}</span>
                      {boit && (
                        <span className="shrink-0 text-[13px] text-encre-2">
                          {gorgees(boit.nombre)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          ) : maReponse ? (
            <motion.div
              key="attente"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center"
            >
              <p className="text-[15px] text-encre-2">C&apos;est envoyé.</p>
              <p className="mt-2 text-[13px] text-encre-3">
                {reponses.length} sur {etat.presents.length} ont répondu.
              </p>
            </motion.div>
          ) : libre ? (
            <motion.div key="libre" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {/* Trois champs plutôt qu'un : « Top 3 » se compte place par
                  place, et une seule ligne à découper laisserait l'ordre au
                  hasard des virgules. */}
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  value={brouillon[i]}
                  onChange={(e) =>
                    setBrouillon((avant) =>
                      avant.map((v, j) => (j === i ? e.target.value : v)),
                    )
                  }
                  placeholder={`${i + 1}…`}
                  className="champ-saisie mb-2 w-full rounded-2xl border border-trait bg-surface-2 px-4 py-3 placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
                />
              ))}
              <button
                type="button"
                disabled={brouillon.every((v) => !v.trim())}
                onClick={() => moteur.repondre({ liste: brouillon.filter((v) => v.trim()) })}
                style={{ background: "var(--encre)", color: "var(--surface)" }}
                className="mt-2 w-full rounded-[var(--radius-pilule)] px-4 py-3 text-[16px] font-semibold disabled:opacity-40"
              >
                Envoyer
              </button>
            </motion.div>
          ) : (
            <motion.div key="options" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
              {options.map((option) => (
                <button
                  key={option.cle}
                  type="button"
                  onClick={() => moteur.repondre({ choix: option.cle })}
                  className="cible-tactile w-full rounded-2xl border border-trait bg-surface px-4 py-4 text-left text-[16px] leading-snug transition active:bg-surface-2"
                >
                  {option.libelle}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div>
        {/* Qui a répondu, jamais quoi : voir un vote en avance, c'est pouvoir
            s'aligner dessus. */}
        {!revelation && (
          <ul className="mb-4 flex justify-center gap-2">
            {joueurs.map((joueur) => {
              const a = reponses.some((r) => r.membreId === joueur.membreId);
              return (
                <li
                  key={joueur.membreId}
                  className={a ? "" : "opacity-30"}
                  aria-label={`${joueur.pseudo} ${a ? "a répondu" : "n'a pas encore répondu"}`}
                >
                  <Avatar
                    profil={{
                      id: joueur.membreId,
                      pseudo: joueur.pseudo,
                      teinte: joueur.teinte,
                      initiales: joueur.initiales,
                      avatar: joueur.avatar,
                    }}
                    taille={30}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {revelation && moteur.jeSuisHote && (
          <button
            type="button"
            onClick={moteur.suivante}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="w-full rounded-[var(--radius-pilule)] px-4 py-3.5 text-[16px] font-semibold"
          >
            Manche suivante
          </button>
        )}
        {revelation && !moteur.jeSuisHote && (
          <p className="text-center text-[13px] text-encre-3">L&apos;hôte enchaîne.</p>
        )}
      </div>
    </div>
  );
}
