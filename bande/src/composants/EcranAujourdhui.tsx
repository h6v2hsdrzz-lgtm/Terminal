"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { Avatar } from "./Avatar";
import { Carte, TitreSection } from "./Carte";
import { CarteEntree } from "./CarteEntree";
import { CurseurJoie } from "./CurseurJoie";
import { VisageJoie } from "./VisageJoie";
import { BANDE, DECLENCHEURS, MOI, PROFILS } from "@/lib/factices";
import { enTexteLong } from "@/lib/dates";
import type { Entree } from "@/lib/types";

/**
 * L'écran d'accueil, et le cœur du produit.
 *
 * Tant qu'on n'a pas posé sa journée, celles des autres restent floues. Ce
 * n'est pas une punition : c'est ce qui fait qu'on écrit ce qu'on pense
 * vraiment plutôt que de s'aligner sur ce qu'ont mis les autres. La
 * révélation, elle, est franche : tout se découvre d'un coup.
 */
/**
 * « toi manque à l'appel » ne se dit pas. La deuxième personne demande son
 * propre verbe, et le tour est différent selon qu'il reste une personne ou
 * plusieurs.
 */
function phraseManquants(manquants: { id: string; pseudo: string }[]): string {
  const moiDedans = manquants.some((p) => p.id === MOI);
  const autres = manquants.filter((p) => p.id !== MOI).map((p) => p.pseudo);

  if (moiDedans && autres.length === 0) return "Il ne manque plus que toi.";
  if (moiDedans) {
    return `Toi et ${autres.join(" et ")} n'avez pas encore posé votre journée.`;
  }
  return autres.length === 1
    ? `${autres[0]} n'a pas encore posé sa journée.`
    : `${autres.slice(0, -1).join(", ")} et ${autres.at(-1)} n'ont pas encore posé leur journée.`;
}

export function EcranAujourdhui({
  jour,
  entreesDuJour,
  serieCollective,
}: {
  jour: string;
  entreesDuJour: Entree[];
  serieCollective: number;
}) {
  const [maJoie, setMaJoie] = useState(7);
  const [mesDeclencheurs, setMesDeclencheurs] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [poste, setPoste] = useState(false);

  const entreesVisibles = poste
    ? [
        {
          id: "moi-aujourdhui",
          jour,
          profil: MOI,
          joie: maJoie,
          note: note.trim() || null,
          declencheurs: mesDeclencheurs,
          photo: null,
          reactions: [],
          commentaires: [],
          posteA: "à l'instant",
        } as Entree,
        ...entreesDuJour,
      ]
    : entreesDuJour;

  const moyenne = entreesVisibles.length
    ? entreesVisibles.reduce((s, e) => s + e.joie, 0) / entreesVisibles.length
    : null;

  const manquants = PROFILS.filter(
    (p) => !entreesVisibles.some((e) => e.profil === p.id),
  );

  return (
    <div className="px-4 pt-3">
      <header className="mb-5 flex items-center justify-between gap-3 zone-sure-haute">
        <div>
          <p className="text-[13px] font-medium text-encre-3">{BANDE.nom}</p>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] first-letter:uppercase">
            {enTexteLong(jour)}
          </h1>
        </div>
        {serieCollective > 0 && (
          <div className="shrink-0 rounded-[var(--radius-pilule)] border border-trait bg-surface px-3 py-1.5 text-center shadow-[var(--ombre-1)]">
            <span className="chiffres text-[17px]">{serieCollective}</span>
            <span className="ml-1 text-[12px] text-encre-3">jours</span>
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
              <p className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
                Ta journée
              </p>

              <CurseurJoie valeurInitiale={maJoie} onChange={setMaJoie} />

              <div className="mt-5 flex flex-wrap gap-2">
                {DECLENCHEURS.map((d) => {
                  const actif = mesDeclencheurs.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      aria-pressed={actif}
                      onClick={() =>
                        setMesDeclencheurs((liste) =>
                          liste.includes(d.id) ? liste.filter((x) => x !== d.id) : [...liste, d.id],
                        )
                      }
                      className={`rounded-[var(--radius-pilule)] border px-3.5 py-2 text-[14px] transition ${
                        actif
                          ? "border-encre bg-encre font-medium text-[var(--surface)]"
                          : "border-trait-fort bg-surface-2 text-encre-2 hover:border-encre-3"
                      }`}
                    >
                      {d.emoji} {d.nom}
                    </button>
                  );
                })}
              </div>

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={280}
                placeholder="Ce qui a fait la journée… (facultatif)"
                className="mt-4 w-full resize-none rounded-2xl border border-trait bg-surface-2 px-3.5 py-3 text-[15px] placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
              />

              <button
                type="button"
                onClick={() => setPoste(true)}
                className="mt-4 w-full rounded-[var(--radius-pilule)] py-3.5 text-[15px] font-semibold text-white transition active:scale-[0.99]"
                style={{ background: "var(--encre)", color: "var(--surface)" }}
              >
                Poser ma joie du jour
              </button>
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
              <VisageJoie valeur={maJoie} taille={64} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-encre-3">C&apos;est posé pour aujourd&apos;hui</p>
                <p className="mt-0.5 text-[15px] text-encre-2">
                  {note.trim() || "Sans commentaire, et c'est très bien."}
                </p>
              </div>
              <span className="chiffres text-[26px]" style={{ color: "var(--joie-encre)" }}>
                {maJoie}
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
            {PROFILS.map((profil) => {
              const aPoste = entreesVisibles.some((e) => e.profil === profil.id);
              return (
                <div key={profil.id} className="flex flex-col items-center gap-1.5">
                  <Avatar profil={profil} taille={44} anneau={aPoste} attenue={!aPoste} />
                  <span className={`text-[12px] ${aPoste ? "text-encre-2" : "text-encre-3"}`}>
                    {profil.id === MOI ? "toi" : profil.pseudo}
                  </span>
                </div>
              );
            })}

            <div className="ml-auto text-right">
              {poste && moyenne !== null ? (
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
                  L&apos;humeur de la bande se dévoile quand tu as posé la tienne.
                </p>
              )}
            </div>
          </div>

          {manquants.length > 0 && (
            <p className="mt-3 border-t border-trait pt-3 text-[13px] text-encre-3">
              {phraseManquants(manquants)}
            </p>
          )}
        </Carte>
      </section>

      {/* ── Le fil du jour ──────────────────────────────────────────── */}
      <section className="mt-7">
        <TitreSection>Aujourd&apos;hui</TitreSection>

        <div className="relative space-y-3">
          {entreesDuJour.map((entree, index) => (
            <motion.div
              key={entree.id}
              initial={false}
              animate={{ opacity: 1 }}
              transition={{ delay: poste ? index * 0.06 : 0, type: "spring", stiffness: 300, damping: 28 }}
            >
              <CarteEntree entree={entree} floute={!poste} />
            </motion.div>
          ))}

          <AnimatePresence>
            {!poste && (
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
      </section>
    </div>
  );
}
