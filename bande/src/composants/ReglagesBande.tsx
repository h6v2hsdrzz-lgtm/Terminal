"use client";

import { useState, useTransition } from "react";

import { Carte, TitreSection } from "./Carte";
import { MessageErreur, styleChamp } from "./Champ";
import {
  actionAjouterDeclencheur,
  actionRenommerBande,
  actionReglerDevoilement,
  actionRetirerDeclencheur,
} from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import type { Declencheur } from "@/lib/types";

const MAX_DECLENCHEURS = 8;

export function ReglagesBande({
  nom,
  revelerApresPost,
  declencheurs,
}: {
  nom: string;
  revelerApresPost: boolean;
  declencheurs: Declencheur[];
}) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const [nomSaisi, setNomSaisi] = useState(nom);
  const [nouveauNom, setNouveauNom] = useState("");
  const [nouvelEmoji, setNouvelEmoji] = useState("");
  const [voile, setVoile] = useState(revelerApresPost);

  const lancer = (travail: () => Promise<{ erreur: string | null }>) =>
    demarrer(async () => setEtat(await travail()));

  return (
    <>
      <section className="mt-7">
        <TitreSection>Le nom</TitreSection>
        <Carte className="p-4">
          <form
            action={(donnees) => lancer(() => actionRenommerBande(ETAT_INITIAL, donnees))}
            className="flex gap-2"
          >
            <label htmlFor="nom-bande" className="sr-only">Nom de la bande</label>
            <input
              id="nom-bande"
              name="nom"
              value={nomSaisi}
              onChange={(e) => setNomSaisi(e.target.value)}
              maxLength={40}
              className={`${styleChamp} flex-1`}
            />
            <button
              type="submit"
              disabled={enCours || nomSaisi.trim() === nom || !nomSaisi.trim()}
              className="shrink-0 rounded-[var(--radius-pilule)] border border-trait-fort bg-surface px-4 text-[14px] font-medium transition hover:border-encre-3 disabled:opacity-40"
            >
              Renommer
            </button>
          </form>
        </Carte>
      </section>

      <section className="mt-7">
        <TitreSection>Le voile</TitreSection>
        <Carte className="p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={voile}
              onChange={(e) => {
                const valeur = e.target.checked;
                setVoile(valeur);
                lancer(() => actionReglerDevoilement(valeur));
              }}
              className="peer sr-only"
            />
            {/* Un interrupteur dessiné plutôt qu'une case : c'est un réglage
                qui s'active, pas une option à cocher dans un formulaire. */}
            <span
              aria-hidden
              className="mt-0.5 h-[26px] w-[44px] shrink-0 rounded-full border border-trait-fort bg-surface-2 p-[3px] transition peer-checked:border-encre peer-checked:bg-encre peer-focus-visible:ring-2 peer-focus-visible:ring-[color-mix(in_oklab,var(--encre)_28%,transparent)]"
            >
              <span
                className="block h-[18px] w-[18px] rounded-full bg-surface shadow-[var(--ombre-1)] transition-transform"
                style={{ transform: voile ? "translateX(18px)" : "none", background: voile ? "var(--surface)" : "var(--encre-3)" }}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-medium">
                Cacher les journées tant qu&apos;on n&apos;a pas posé la sienne
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-encre-3">
                C&apos;est ce qui fait qu&apos;on écrit ce qu&apos;on pense vraiment plutôt que de
                s&apos;aligner sur ce qu&apos;ont mis les autres. Désactivé, tout est visible tout
                le temps.
              </span>
            </span>
          </label>
        </Carte>
      </section>

      <section className="mt-7">
        <TitreSection action={<span className="text-[13px] text-encre-3">{declencheurs.length} / {MAX_DECLENCHEURS}</span>}>
          Les déclencheurs
        </TitreSection>
        <Carte className="p-4">
          <ul className="space-y-2">
            {declencheurs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2">
                <span className="text-[19px] leading-none">{d.emoji}</span>
                <span className="flex-1 text-[15px]">{d.nom}</span>
                <button
                  type="button"
                  onClick={() => lancer(() => actionRetirerDeclencheur(d.id))}
                  disabled={enCours}
                  className="text-[13px] text-encre-3 underline underline-offset-2 transition hover:text-encre-2 disabled:opacity-40"
                >
                  retirer
                </button>
              </li>
            ))}
          </ul>

          {declencheurs.length < MAX_DECLENCHEURS && (
            <form
              action={(donnees) => {
                lancer(async () => {
                  const resultat = await actionAjouterDeclencheur(ETAT_INITIAL, donnees);
                  if (!resultat.erreur) { setNouveauNom(""); setNouvelEmoji(""); }
                  return resultat;
                });
              }}
              // Deux rangées plutôt qu'une : en une seule, sur 390 pixels, le
              // bouton passait hors du cadre. Une grille fixe ne dépend pas de
              // la longueur du libellé.
              className="mt-3 grid grid-cols-[4.5rem_1fr] gap-2"
            >
              <label htmlFor="emoji" className="sr-only">Émoji</label>
              <input
                id="emoji"
                name="emoji"
                value={nouvelEmoji}
                onChange={(e) => setNouvelEmoji(e.target.value)}
                required
                maxLength={8}
                placeholder="🎸"
                className={`${styleChamp} px-0 text-center`}
              />
              <label htmlFor="declencheur" className="sr-only">Nom du déclencheur</label>
              <input
                id="declencheur"
                name="nom"
                value={nouveauNom}
                onChange={(e) => setNouveauNom(e.target.value)}
                required
                maxLength={24}
                placeholder="Répétition"
                className={`${styleChamp} min-w-0`}
              />
              <button
                type="submit"
                disabled={enCours || !nouveauNom.trim() || !nouvelEmoji.trim()}
                style={{ background: "var(--encre)", color: "var(--surface)" }}
                className="col-span-2 rounded-[var(--radius-pilule)] py-2.5 text-[14px] font-semibold transition disabled:opacity-40"
              >
                Ajouter
              </button>
            </form>
          )}

          <p className="mt-3 text-[13px] leading-snug text-encre-3">
            Retirer un déclencheur le sort du formulaire du soir mais garde les
            journées qui le portaient : les statistiques passées restent vraies.
          </p>
        </Carte>
      </section>

      {etat.erreur && (
        <div className="mt-4">
          <MessageErreur>{etat.erreur}</MessageErreur>
        </div>
      )}
    </>
  );
}
