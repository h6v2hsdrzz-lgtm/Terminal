"use client";

import { useState } from "react";

import { Avatar } from "../../Avatar";
import { CarteDevine } from "../CarteDevine";
import type { Jeu } from "@/lib/jeux/catalogue";

import type { MoteurMulti } from "./CoquilleMulti";
import { EcranVote } from "./EcranVote";
import { PHASES, reponsesDe } from "./protocole";

/**
 * Un joueur agit, les autres regardent — ou jugent.
 *
 * C'est ici que le multi apporte le plus : **l'écran de l'acteur n'est pas
 * celui des autres**. « Devine qui je suis » se jouait en posant le téléphone
 * sur son front ; maintenant, le mot s'affiche chez les deux autres, et
 * l'acteur regarde son propre écran comme tout le monde. Plus de front, plus
 * d'appareil qui tombe, plus de triche involontaire en apercevant l'écran.
 */
export function EcranTour({ moteur, jeu }: { moteur: MoteurMulti; jeu: Jeu }) {
  const { etat, recette, joueurs, moi, acteur } = moteur;
  const jeSuisLActeur = acteur === moi;
  const nomActeur = joueurs.find((j) => j.membreId === acteur)?.pseudo ?? "quelqu'un";
  const [affirmations, setAffirmations] = useState<string[]>(["", "", ""]);
  const [fausse, setFausse] = useState<number | null>(null);
  const [reponseLibre, setReponseLibre] = useState("");

  const revelation = etat.phase === PHASES.revelation;
  const reponses = reponsesDe(etat, etat.phase ?? "");

  // ── « Menteur », une fois les trois affirmations écrites ────────────────
  //
  // À partir de là, c'est un vote comme un autre : l'écran de vote sait déjà
  // afficher des options, cacher QUI a voté QUOI avant la révélation, et rendre
  // le résultat avec les libellés plutôt qu'avec des numéros. Le seul écart,
  // c'est que l'acteur ne vote pas — il a écrit le mensonge, il regarde les
  // autres le chercher. En révélation, tout le monde voit la même chose.
  if (jeu.cle === "menteur" && etat.phase !== PHASES.preparation) {
    if (!revelation && jeSuisLActeur) {
      return <Attente texte="Ils cherchent le mensonge." joueurs={joueurs} />;
    }
    return <EcranVote moteur={moteur} />;
  }

  if (revelation) {
    return (
      <div className="flex min-h-[70dvh] flex-col justify-between px-4 py-6">
        <p className="text-[22px] font-semibold leading-tight">
          {String(etat.donneesPhase.verdict ?? "")}
        </p>
        {moteur.jeSuisHote ? (
          <button
            type="button"
            onClick={moteur.suivante}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="w-full rounded-[var(--radius-pilule)] px-4 py-3.5 text-[16px] font-semibold"
          >
            Manche suivante
          </button>
        ) : (
          <p className="text-center text-[13px] text-encre-3">L&apos;hôte enchaîne.</p>
        )}
      </div>
    );
  }

  // ── « Menteur » : l'acteur écrit d'abord ───────────────────────────────
  if (etat.phase === PHASES.preparation) {
    if (!jeSuisLActeur) {
      return <Attente texte={`${nomActeur} écrit ses trois affirmations.`} joueurs={joueurs} />;
    }
    return (
      <div className="px-4 py-6">
        <p className="text-[20px] font-semibold leading-tight">
          {recette.enonceActeur?.(etat.donneesPhase) ?? ""}
        </p>
        <p className="mt-2 text-[14px] text-encre-3">
          Touche celle qui est fausse avant d&apos;envoyer.
        </p>
        <div className="mt-5 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={affirmations[i]}
                onChange={(e) =>
                  setAffirmations((avant) => avant.map((v, j) => (j === i ? e.target.value : v)))
                }
                placeholder={`Affirmation ${i + 1}`}
                className="champ-saisie min-w-0 flex-1 rounded-2xl border border-trait bg-surface-2 px-4 py-3 placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setFausse(i)}
                aria-pressed={fausse === i}
                aria-label={`Marquer l'affirmation ${i + 1} comme fausse`}
                className={`cible-tactile shrink-0 rounded-full border px-3 py-2 text-[13px] ${
                  fausse === i ? "border-encre-3 bg-surface-3 font-semibold" : "border-trait"
                }`}
              >
                fausse
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={fausse === null || affirmations.some((a) => !a.trim())}
          onClick={() =>
            moteur.repondre({ affirmations, fausse: String(fausse) })
          }
          style={{ background: "var(--encre)", color: "var(--surface)" }}
          className="mt-5 w-full rounded-[var(--radius-pilule)] px-4 py-3.5 text-[16px] font-semibold disabled:opacity-40"
        >
          Envoyer
        </button>
      </div>
    );
  }

  // ── « Devine qui je suis » : le mot est chez les AUTRES ─────────────────
  if (jeu.cle === "devine-qui") {
    if (jeSuisLActeur) {
      return (
        <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-8 px-4">
          <p className="text-center text-[22px] font-semibold leading-tight">
            {recette.enonceActeur?.(etat.donneesPhase) ?? "À toi."}
          </p>
          <div className="flex w-full gap-3">
            <button
              type="button"
              onClick={() => moteur.repondre({ trouve: false })}
              className="cible-tactile flex-1 rounded-2xl border border-trait bg-surface px-4 py-6 text-[17px] font-semibold"
            >
              Passer
            </button>
            <button
              type="button"
              onClick={() => moteur.repondre({ trouve: true })}
              style={{ background: "var(--encre)", color: "var(--surface)" }}
              className="cible-tactile flex-1 rounded-2xl px-4 py-6 text-[17px] font-semibold"
            >
              Trouvé
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="relative">
        <CarteDevine carte={recette.enonce(etat.donneesPhase)} />
        {/* Au-dessus de l'image, pas en dessous : c'est la seule ligne qui dit
            quoi faire, et elle doit rester lisible sur une photo claire. */}
        <p
          className="absolute inset-x-0 top-0 px-5 pt-4 text-center text-[13px] uppercase tracking-[0.08em]"
          style={{ color: "rgba(255,255,255,0.9)", textShadow: "0 1px 12px rgba(0,0,0,0.7)" }}
        >
          Fais deviner à {nomActeur}
        </p>

        {/*
          Les deux souffleurs ont eux aussi « Trouvé » et « Passer ».

          Le plan les demandait de ce côté-ci ; ils n'étaient que chez celui qui
          devine, et ça ne s'est vu qu'en jouant à TROIS téléphones. Les deux
          endroits se valent et c'est pour ça qu'ils coexistent : celui qui
          devine est le seul à pouvoir décider d'abandonner, et les souffleurs
          sont les seuls à savoir si ce qu'il vient de dire est juste. Le
          premier qui appuie termine la manche.

          Compacts et en bas : le nom de la carte occupe le bas de l'image, et
          des pavés pleine hauteur le recouvriraient — or c'est justement ce
          qu'il faut lire.
        */}
        <div className="absolute inset-x-0 bottom-0 flex gap-2 px-4 pb-5">
          <button
            type="button"
            onClick={() => moteur.repondre({ trouve: false })}
            className="cible-tactile flex-1 rounded-[var(--radius-pilule)] py-3 text-[15px] font-semibold"
            style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
          >
            Passer
          </button>
          <button
            type="button"
            onClick={() => moteur.repondre({ trouve: true })}
            className="cible-tactile flex-1 rounded-[var(--radius-pilule)] py-3 text-[15px] font-semibold"
            style={{ background: "#fff", color: "#000" }}
          >
            Trouvé
          </button>
        </div>
      </div>
    );
  }

  // ── « Le jugement » : les autres répondent, l'acteur tranche ────────────
  if (jeSuisLActeur) {
    const recues = reponses.filter((r) => r.membreId !== acteur);
    return (
      <div className="px-4 py-6">
        <p className="text-[20px] font-semibold leading-tight">
          {recette.enonceActeur?.(etat.donneesPhase) ?? recette.enonce(etat.donneesPhase)}
        </p>
        {recues.length === 0 ? (
          <p className="mt-6 text-[15px] text-encre-3">Ils réfléchissent.</p>
        ) : (
          <ul className="mt-5 space-y-2">
            {recues.map((reponse) => (
              <li key={reponse.membreId}>
                <button
                  type="button"
                  onClick={() => moteur.repondre({ gagnant: reponse.membreId })}
                  className="cible-tactile w-full rounded-2xl border border-trait bg-surface px-4 py-4 text-left text-[16px] leading-snug active:bg-surface-2"
                >
                  {String(reponse.donnees.texte ?? "—")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[13px] text-encre-3">
          Touche celle qui gagne. C&apos;est toi le juge, il n&apos;y a pas d&apos;appel.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <p className="text-[22px] font-semibold leading-tight">
        {recette.enonce(etat.donneesPhase)}
      </p>
      <p className="mt-2 text-[14px] text-encre-3">{nomActeur} jugera.</p>
      {reponses.some((r) => r.membreId === moi) ? (
        <p className="mt-8 text-center text-[15px] text-encre-2">C&apos;est envoyé.</p>
      ) : (
        <>
          <textarea
            value={reponseLibre}
            onChange={(e) => setReponseLibre(e.target.value)}
            rows={3}
            maxLength={200}
            placeholder="Ta réponse…"
            className="champ-saisie mt-5 w-full resize-none rounded-2xl border border-trait bg-surface-2 px-4 py-3 placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
          />
          <button
            type="button"
            disabled={!reponseLibre.trim()}
            onClick={() => moteur.repondre({ texte: reponseLibre.trim() })}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="mt-3 w-full rounded-[var(--radius-pilule)] px-4 py-3.5 text-[16px] font-semibold disabled:opacity-40"
          >
            Envoyer
          </button>
        </>
      )}
    </div>
  );
}

function Attente({ texte, joueurs }: { texte: string; joueurs: MoteurMulti["joueurs"] }) {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-4">
      <p className="text-center text-[17px] leading-snug text-encre-2">{texte}</p>
      <ul className="flex gap-2">
        {joueurs.map((joueur) => (
          <li key={joueur.membreId}>
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
        ))}
      </ul>
    </div>
  );
}
