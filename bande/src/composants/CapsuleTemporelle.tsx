"use client";

import { useState, useTransition } from "react";

import { Carte, TitreSection } from "./Carte";
import { MessageErreur, styleChamp } from "./Champ";
import { actionEcrireCapsule, actionSupprimerCapsule } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import { decaler, enTexteLongAvecAnnee } from "@/lib/dates";
import type { Capsule } from "@/lib/depot";

/**
 * Un mot écrit aujourd'hui, scellé jusqu'à une date choisie.
 *
 * Le texte d'une capsule non ouverte ne quitte jamais le serveur. Le cacher
 * côté client reviendrait à l'envoyer et à demander poliment de ne pas
 * regarder — ce qui n'est pas la même chose, et se contourne d'un clic droit.
 *
 * Ce n'est pas du chiffrement pour autant : le texte est lisible en base par
 * qui l'administre. C'est une convention entre amis, et le README le dit.
 */
const DELAI_MIN = 7;
const LONGUEUR_MAX = 1000;

export function CapsuleTemporelle({
  capsules,
  aujourdhui,
  moi,
}: {
  capsules: Capsule[];
  aujourdhui: string;
  moi: string;
}) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState("");
  const [quand, setQuand] = useState(decaler(aujourdhui, 365));

  const ouvertes = capsules.filter((c) => c.texte !== null);
  const scellees = capsules.filter((c) => c.texte === null);

  return (
    <section className="mt-7">
      <TitreSection
        action={
          !ouvert && (
            <button
              type="button"
              onClick={() => setOuvert(true)}
              className="text-[13px] text-encre-2 underline underline-offset-2 hover:text-encre"
            >
              en écrire une
            </button>
          )
        }
      >
        Capsules
      </TitreSection>

      {ouvert && (
        <Carte className="mb-3 p-4">
          <form
            action={(donnees) =>
              demarrer(async () => {
                const resultat = await actionEcrireCapsule(ETAT_INITIAL, donnees);
                setEtat(resultat);
                if (!resultat.erreur) { setTexte(""); setOuvert(false); }
              })
            }
          >
            <label htmlFor="capsule" className="mb-1.5 block text-[14px] font-medium">
              À lire plus tard
            </label>
            <textarea
              id="capsule"
              name="texte"
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              rows={4}
              maxLength={LONGUEUR_MAX}
              required
              placeholder="Ce qu'on vit en ce moment, et ce qu'on espère pour la suite…"
              className="champ-saisie w-full resize-none rounded-2xl border border-trait bg-surface-2 px-3.5 py-3 placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
            />

            <label htmlFor="ouvrirLe" className="mt-3 mb-1.5 block text-[14px] font-medium">
              À ouvrir le
            </label>
            <input
              id="ouvrirLe"
              name="ouvrirLe"
              type="date"
              value={quand}
              min={decaler(aujourdhui, DELAI_MIN)}
              onChange={(e) => setQuand(e.target.value)}
              required
              className={styleChamp}
            />
            <p className="mt-1.5 text-[13px] leading-snug text-encre-3">
              Une fois scellée, personne ne peut la lire avant cette date — même pas
              toi. Au moins {DELAI_MIN} jours, sinon ce n&apos;est pas une capsule.
            </p>

            {etat.erreur && (
              <div className="mt-3">
                <MessageErreur>{etat.erreur}</MessageErreur>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => { setOuvert(false); setEtat(ETAT_INITIAL); }}
                className="flex-1 rounded-[var(--radius-pilule)] border border-trait-fort bg-surface py-2.5 text-[14px] font-medium transition hover:border-encre-3"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={enCours || !texte.trim()}
                style={{ background: "var(--encre)", color: "var(--surface)" }}
                className="flex-1 rounded-[var(--radius-pilule)] py-2.5 text-[14px] font-semibold transition disabled:opacity-40"
              >
                {enCours ? "…" : "Sceller"}
              </button>
            </div>
          </form>
        </Carte>
      )}

      {capsules.length === 0 && !ouvert ? (
        <Carte className="p-5">
          <p className="text-[14px] leading-snug text-encre-2">
            Rien de scellé pour l&apos;instant. Écrivez-vous un mot à ouvrir dans un
            an — c&apos;est le genre de chose qu&apos;on ne regrette jamais d&apos;avoir fait.
          </p>
        </Carte>
      ) : (
        <div className="space-y-3">
          {ouvertes.map((capsule) => (
            <Carte key={capsule.id} className="p-4">
              <p className="text-[12px] text-encre-3">
                {capsule.auteurId === moi ? "Toi" : capsule.auteur}, le{" "}
                {enTexteLongAvecAnnee(capsule.creeLe, aujourdhui)}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-snug">{capsule.texte}</p>
              {capsule.mienne && (
                <button
                  type="button"
                  onClick={() => demarrer(async () => setEtat(await actionSupprimerCapsule(capsule.id)))}
                  className="mt-2 text-[12px] text-encre-3 underline underline-offset-2 hover:text-encre-2"
                >
                  supprimer
                </button>
              )}
            </Carte>
          ))}

          {scellees.map((capsule) => (
            <Carte key={capsule.id} className="flex items-center gap-3 p-4">
              <span className="text-[22px] leading-none grayscale" aria-hidden>🔒</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px]">
                  {capsule.auteurId === moi ? "Ton" : `Le`} mot
                  {capsule.auteurId === moi ? "" : ` de ${capsule.auteur}`}, scellé
                </p>
                <p className="mt-0.5 text-[13px] text-encre-3">
                  s&apos;ouvre le {enTexteLongAvecAnnee(capsule.ouvrirLe, aujourdhui)}
                </p>
              </div>
              {capsule.mienne && (
                <button
                  type="button"
                  onClick={() => demarrer(async () => setEtat(await actionSupprimerCapsule(capsule.id)))}
                  className="shrink-0 text-[12px] text-encre-3 underline underline-offset-2 hover:text-encre-2"
                >
                  supprimer
                </button>
              )}
            </Carte>
          ))}
        </div>
      )}
    </section>
  );
}
