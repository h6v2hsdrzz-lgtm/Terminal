"use client";

import { useState, useTransition } from "react";

import { Carte, TitreSection } from "./Carte";
import { MessageErreur, styleChamp } from "./Champ";
import { actionQuitter, actionQuitterLaBande, actionQuitterLaBandeSimple } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";

/**
 * Emporter ses affaires, et partir.
 *
 * L'export vient avant le départ, et pas seulement dans l'ordre de la page :
 * une application où les données ne sortent pas est une application qui vous
 * retient. On peut tout récupérer sans rien supprimer.
 */
export function ZoneDepart({
  nomBande,
  seul,
  apresEmporter,
}: {
  nomBande: string;
  seul: boolean;
  /**
   * Ce qui s'intercale entre « Emporter » et « Partir ».
   *
   * La restauration vivait après « Partir », donc **après** le bouton qui
   * efface tout. Vu sur une capture : on ne range pas « remets tes données »
   * derrière « supprime tes données ». Elle appartient à côté de l'export,
   * et « Partir » reste le dernier bloc de l'écran — c'est le plus définitif.
   */
  apresEmporter?: React.ReactNode;
}) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const [ouvert, setOuvert] = useState(false);
  const [saisi, setSaisi] = useState("");

  return (
    <>
      {/* Se déconnecter, et rien d'autre.
          C'est le geste le plus banal d'une application et le plus dangereux de
          celle-ci : sans mot de passe, le code de reprise est la SEULE façon de
          revenir. On le dit avant, pas après. */}
      <section className="mt-7">
        <TitreSection>Se déconnecter</TitreSection>
        <Carte className="p-4">
          <p className="text-[14px] leading-snug text-encre-2">
            Se déconnecter efface la session de ce téléphone. Tes journées restent,
            la bande reste — mais pour revenir il faudra <strong>ton code de
            reprise</strong>, et c&apos;est la seule façon.
          </p>
          <a
            href="/reprendre"
            className="cible-tactile mt-3 inline-flex text-[13px] text-encre-3 underline underline-offset-2"
          >
            Revoir comment on revient
          </a>
          <form action={actionQuitter}>
            <button
              type="submit"
              className="cible-tactile mt-3 w-full rounded-[var(--radius-pilule)] border border-trait-fort bg-surface py-2.5 text-center text-[15px] font-medium transition hover:border-encre-3"
            >
              Se déconnecter
            </button>
          </form>
        </Carte>
      </section>

      <section className="mt-7">
        <TitreSection>Emporter</TitreSection>
        <Carte className="p-4">
          <div className="flex gap-2">
            {/* Des liens, pas des boutons : le navigateur sait télécharger, et
                un lien fonctionne même si le JavaScript n'a pas chargé. */}
            <a
              href="/api/export"
              download
              className="flex-1 rounded-[var(--radius-pilule)] border border-trait-fort bg-surface py-2.5 text-center text-[14px] font-medium transition hover:border-encre-3"
            >
              JSON
            </a>
            <a
              href="/api/export?format=csv"
              download
              className="flex-1 rounded-[var(--radius-pilule)] border border-trait-fort bg-surface py-2.5 text-center text-[14px] font-medium transition hover:border-encre-3"
            >
              Tableur
            </a>
          </div>

          {/* La sauvegarde complète a son propre bouton, plus gros que les deux
              autres : c'est la seule des trois qui ramène quelque chose le jour
              où la base disparaît. */}
          <a
            href="/api/export?format=zip"
            download
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="cible-tactile mt-2 flex w-full items-center justify-center rounded-[var(--radius-pilule)] py-3 text-center text-[15px] font-semibold"
          >
            Sauvegarde complète (.zip)
          </a>

          <p className="mt-2.5 text-[13px] leading-snug text-encre-3">
            Le <b>.zip</b> emporte tout, <b>photos et vocaux compris</b> — c&apos;est
            lui qu&apos;on garde. Le JSON et le tableur ne portent que le texte : le
            premier garde la structure, le second met à plat de quoi faire ses
            propres calculs.
          </p>
        </Carte>
      </section>

      {apresEmporter}

      <section className="mt-7 mb-4">
        <TitreSection>Partir</TitreSection>
        <Carte className="p-4">
          {/* Un `<details>` plutôt qu'un bouton et un état : la confirmation
              s'ouvre sans JavaScript, et supprimer ses données ne doit jamais
              en dépendre. */}
          <details open={ouvert} onToggle={(e) => setOuvert(e.currentTarget.open)}>
            <summary className="cursor-pointer list-none rounded-[var(--radius-pilule)] border border-trait-fort bg-surface py-2.5 text-center text-[14px] font-medium text-encre-2 transition hover:border-encre-3">
              Quitter la bande
            </summary>

            <form
              action={actionQuitterLaBandeSimple}
              onSubmit={(e) => {
                e.preventDefault();
                const donnees = new FormData(e.currentTarget);
                demarrer(async () => setEtat(await actionQuitterLaBande(ETAT_INITIAL, donnees)));
              }}
              className="mt-3"
            >
              <p className="text-[14px] leading-snug">
                {seul ? (
                  <>
                    Tu es la dernière personne de la bande : en partant, tu
                    l&apos;emportes avec toi. Toutes les journées seront effacées.
                  </>
                ) : (
                  <>
                    Tes journées, tes réactions et tes commentaires seront effacés.
                    Ceux des autres restent.
                  </>
                )}
              </p>
              <label htmlFor="confirmation" className="mt-3 mb-1.5 block text-[13px] text-encre-2">
                Recopie <b>{nomBande}</b> pour confirmer.
              </label>
              {/* Une phrase à retaper plutôt qu'un second bouton : un bouton se
                  clique par erreur, un nom ne se recopie pas par accident. */}
              <input
                id="confirmation"
                name="confirmation"
                value={saisi}
                onChange={(e) => setSaisi(e.target.value)}
                autoComplete="off"
                className={styleChamp}
              />

              {etat.erreur && (
                <div className="mt-3">
                  <MessageErreur>{etat.erreur}</MessageErreur>
                </div>
              )}

              <button
                type="submit"
                disabled={enCours}
                style={{ background: "var(--encre)", color: "var(--surface)" }}
                className="mt-3 w-full rounded-[var(--radius-pilule)] py-2.5 text-[14px] font-semibold transition disabled:opacity-40"
              >
                {enCours ? "…" : "Partir pour de bon"}
              </button>
            </form>
          </details>

          <p className="mt-2.5 text-[13px] leading-snug text-encre-3">
            Tes journées partent avec toi, ainsi que tes réactions et tes
            commentaires. C&apos;est définitif — pense à exporter avant.
          </p>
        </Carte>
      </section>
    </>
  );
}
