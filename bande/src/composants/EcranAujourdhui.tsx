"use client";

import { AnimatePresence, motion } from "motion/react";
import { useActionState, useState } from "react";

import { Avatar } from "./Avatar";
import { Carte, TitreSection } from "./Carte";
import { CarteEntree } from "./CarteEntree";
import { CurseurJoie } from "./CurseurJoie";
import { MessageErreur } from "./Champ";
import { VisageJoie } from "./VisageJoie";
import { actionPoserJournee } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import { enTexteLong } from "@/lib/dates";
import type { Annuaire, Entree, Profil } from "@/lib/types";

/**
 * L'écran d'accueil, et le cœur du produit.
 *
 * Tant qu'on n'a pas posé sa journée, celles des autres restent floues. Ce
 * n'est pas une punition : c'est ce qui fait qu'on écrit ce qu'on pense
 * vraiment plutôt que de s'aligner sur ce qu'ont mis les autres. La
 * révélation, elle, est franche : tout se découvre d'un coup.
 *
 * Le fait d'avoir posé sa journée vient du serveur, pas d'un état local : c'est
 * une ligne en base, avec une contrainte d'unicité par personne et par jour.
 * Rouvrir l'application depuis un autre appareil montre donc le même écran.
 */

/**
 * « toi manque à l'appel » ne se dit pas. La deuxième personne demande son
 * propre verbe, et le tour est différent selon qu'il reste une personne ou
 * plusieurs.
 */
function phraseManquants(manquants: Profil[], moi: string): string {
  const moiDedans = manquants.some((p) => p.id === moi);
  const autres = manquants.filter((p) => p.id !== moi).map((p) => p.pseudo);

  // « Toi et Sam et Samy » : une énumération prend des virgules, et « et »
  // seulement devant le dernier.
  const enumerer = (noms: string[]) =>
    noms.length <= 1 ? (noms[0] ?? "") : `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}`;

  if (moiDedans && autres.length === 0) return "Il ne manque plus que toi.";
  // « Toi » entre dans l'énumération plutôt que d'être collé devant : à deux,
  // c'est « Toi et Sam » ; à trois, « Toi, Sam et Samy ».
  if (moiDedans) return `${enumerer(["Toi", ...autres])} n'avez pas encore posé votre journée.`;
  return autres.length === 1
    ? `${autres[0]} n'a pas encore posé sa journée.`
    : `${enumerer(autres)} n'ont pas encore posé leur journée.`;
}

export function EcranAujourdhui({
  jour,
  nomBande,
  annuaire,
  moi,
  monEntree,
  entreesDesAutres,
  serieCollective,
  revelerApresPost,
}: {
  jour: string;
  nomBande: string;
  annuaire: Annuaire;
  moi: Profil;
  monEntree: Entree | null;
  entreesDesAutres: Entree[];
  serieCollective: number;
  revelerApresPost: boolean;
}) {
  const [etat, envoyer, enCours] = useActionState(actionPoserJournee, ETAT_INITIAL);
  const [maJoie, setMaJoie] = useState(monEntree?.joie ?? 7);

  const poste = monEntree !== null;
  const voile = revelerApresPost && !poste;

  const entreesVisibles = monEntree ? [monEntree, ...entreesDesAutres] : entreesDesAutres;
  const moyenne = entreesVisibles.length
    ? entreesVisibles.reduce((s, e) => s + e.joie, 0) / entreesVisibles.length
    : null;

  const manquants = annuaire.profils.filter(
    (p) => !entreesVisibles.some((e) => e.profil === p.id),
  );

  return (
    <div className="px-4 pt-3">
      <header className="mb-5 flex items-center justify-between gap-3 zone-sure-haute">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-encre-3">{nomBande}</p>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] first-letter:uppercase">
            {enTexteLong(jour)}
          </h1>
        </div>
        {serieCollective > 0 && (
          <div className="shrink-0 rounded-[var(--radius-pilule)] border border-trait bg-surface px-3 py-1.5 text-center shadow-[var(--ombre-1)]">
            <span className="chiffres text-[17px]">{serieCollective}</span>
            <span className="ml-1 text-[12px] text-encre-3">
              {serieCollective > 1 ? "jours" : "jour"}
            </span>
          </div>
        )}
      </header>

      {/* ── Le check-in, ou ce qu'on vient d'écrire ─────────────────── */}
      <AnimatePresence mode="wait" initial={false}>
        {!poste ? (
          <motion.div
            key="saisie"
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: "spring", stiffness: 340, damping: 30 }}
          >
            <Carte className="p-5">
              <form action={envoyer}>
                <p className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
                  Ta journée
                </p>

                <CurseurJoie nom="joie" valeurInitiale={maJoie} onChange={setMaJoie} />

                <fieldset className="mt-5">
                  <legend className="sr-only">Ce qui a marqué la journée</legend>
                  <div className="flex flex-wrap gap-2">
                    {annuaire.declencheurs.map((d) => (
                      <PuceDeclencheur key={d.id} emoji={d.emoji} nom={d.nom} valeur={d.id} />
                    ))}
                  </div>
                </fieldset>

                <label htmlFor="note" className="sr-only">
                  Ce qui a fait la journée
                </label>
                <textarea
                  id="note"
                  name="note"
                  rows={2}
                  maxLength={280}
                  placeholder="Ce qui a fait la journée… (facultatif)"
                  className="mt-4 w-full resize-none rounded-2xl border border-trait bg-surface-2 px-3.5 py-3 text-[15px] placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
                />

                {etat.erreur && (
                  <div className="mt-4">
                    <MessageErreur>{etat.erreur}</MessageErreur>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={enCours}
                  className="mt-4 w-full rounded-[var(--radius-pilule)] py-3.5 text-[15px] font-semibold transition active:scale-[0.99] disabled:opacity-55"
                  style={{ background: "var(--encre)", color: "var(--surface)" }}
                >
                  {enCours ? "Un instant…" : "Poser ma joie du jour"}
                </button>
              </form>
            </Carte>
          </motion.div>
        ) : (
          <motion.div
            key="posee"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            <Carte className="flex items-center gap-4 p-5">
              <VisageJoie valeur={monEntree.joie} taille={64} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-encre-3">C&apos;est posé pour aujourd&apos;hui</p>
                <p className="mt-0.5 text-[15px] text-encre-2">
                  {monEntree.note || "Sans commentaire, et c'est très bien."}
                </p>
              </div>
              <span className="chiffres text-[26px]" style={{ color: "var(--joie-encre)" }}>
                {monEntree.joie}
              </span>
            </Carte>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── La bande ────────────────────────────────────────────────── */}
      <section className="mt-7">
        <TitreSection>La bande</TitreSection>
        <Carte className="p-4">
          <div className="flex items-center gap-3">
            {annuaire.profils.map((profil) => {
              const aPoste = entreesVisibles.some((e) => e.profil === profil.id);
              // Avant d'avoir posé, savoir qui a déjà posté est une information
              // neutre : ça ne dit rien de leur journée, seulement qu'ils sont
              // passés. C'est le chiffre qu'on cache, pas la présence.
              return (
                <div key={profil.id} className="flex flex-col items-center gap-1.5">
                  <Avatar profil={profil} taille={44} anneau={aPoste} attenue={!aPoste} />
                  <span className={`text-[12px] ${aPoste ? "text-encre-2" : "text-encre-3"}`}>
                    {profil.id === moi.id ? "toi" : profil.pseudo}
                  </span>
                </div>
              );
            })}

            <div className="ml-auto text-right">
              {!voile && moyenne !== null ? (
                <>
                  <div className="flex items-baseline justify-end gap-1">
                    <span className="chiffres text-[30px]" style={{ color: "var(--joie-encre)" }}>
                      {moyenne.toFixed(1).replace(".", ",")}
                    </span>
                    <span className="text-[12px] text-encre-3">/ 10</span>
                  </div>
                  <p className="text-[12px] text-encre-3">humeur du jour</p>
                </>
              ) : (
                <p className="max-w-[8.5rem] text-[12px] leading-snug text-encre-3">
                  {voile
                    ? "L'humeur de la bande se dévoile quand tu as posé la tienne."
                    : "Personne n'a encore posé sa journée."}
                </p>
              )}
            </div>
          </div>

          {manquants.length > 0 && (
            <p className="mt-3 border-t border-trait pt-3 text-[13px] text-encre-3">
              {phraseManquants(manquants, moi.id)}
            </p>
          )}
        </Carte>
      </section>

      {/* ── Le fil du jour ──────────────────────────────────────────── */}
      <section className="mt-7">
        <TitreSection>Aujourd&apos;hui</TitreSection>

        {entreesDesAutres.length === 0 ? (
          <Carte className="p-5">
            <p className="text-[14px] leading-snug text-encre-2">
              {poste
                ? "Tu es le premier ce soir. Les autres arriveront."
                : "Personne n'a encore posé sa journée. Ouvre le bal."}
            </p>
          </Carte>
        ) : (
          <div className="relative space-y-3">
            {entreesDesAutres.map((entree, index) => (
              <motion.div
                key={entree.id}
                initial={false}
                animate={{ opacity: 1 }}
                transition={{ delay: voile ? 0 : index * 0.06, type: "spring", stiffness: 300, damping: 28 }}
              >
                <CarteEntree entree={entree} annuaire={annuaire} floute={voile} />
              </motion.div>
            ))}

            <AnimatePresence>
              {voile && (
                <motion.div
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.25 }}
                  className="pointer-events-none absolute inset-0 grid place-items-center"
                >
                  <div className="rounded-[var(--radius-pilule)] border border-trait bg-[var(--voile)] px-4 py-2.5 text-[13px] font-medium text-encre-2 shadow-[var(--ombre-2)] backdrop-blur-md">
                    Pose ta journée pour voir la leur
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Une case à cocher déguisée en pastille.
 *
 * L'apparence est celle d'un bouton, mais le contrôle sous-jacent est une vraie
 * case : elle part avec le formulaire sans JavaScript de collecte, et le
 * clavier comme les lecteurs d'écran la traitent pour ce qu'elle est.
 */
function PuceDeclencheur({ emoji, nom, valeur }: { emoji: string; nom: string; valeur: string }) {
  return (
    <label className="cursor-pointer">
      <input type="checkbox" name="declencheurs" value={valeur} className="peer sr-only" />
      <span
        className="inline-block rounded-[var(--radius-pilule)] border border-trait-fort bg-surface-2 px-3.5 py-2 text-[14px] text-encre-2 transition
                   hover:border-encre-3
                   peer-checked:border-encre peer-checked:bg-encre peer-checked:font-medium peer-checked:text-[var(--surface)]
                   peer-focus-visible:ring-2 peer-focus-visible:ring-[color-mix(in_oklab,var(--encre)_28%,transparent)]"
      >
        {emoji} {nom}
      </span>
    </label>
  );
}
