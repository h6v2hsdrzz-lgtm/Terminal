"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Avatar } from "./Avatar";
import {
  actionCommenter,
  actionReagir,
  actionSupprimerCommentaire,
} from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import type { Annuaire, Commentaire, Reaction } from "@/lib/types";

/**
 * Le bas d'une journée : réagir, commenter.
 *
 * Les réactions sont optimistes. Une pastille qui attend un aller-retour
 * serveur avant de s'allumer donne l'impression d'un bouton cassé, alors que
 * l'opération ne peut pratiquement pas échouer — et si elle échoue, le
 * rafraîchissement du serveur remet la vérité en place tout seul.
 */
const EMOJIS = ["❤️", "😂", "🔥", "🫂", "🙌", "👀"];

type Bascule = { emoji: string };

export function PiedEntree({
  entreeId,
  reactions,
  commentaires,
  annuaire,
  moi,
}: {
  entreeId: string;
  reactions: Reaction[];
  commentaires: Commentaire[];
  annuaire: Annuaire;
  moi: string;
}) {
  const [, demarrer] = useTransition();
  const [ouvert, setOuvert] = useState(false);
  const [choixOuvert, setChoixOuvert] = useState(false);

  const [vue, basculer] = useOptimistic(reactions, (etat: Reaction[], { emoji }: Bascule) => {
    const existante = etat.find((r) => r.emoji === emoji);
    if (!existante) return [...etat, { emoji, parQui: [moi] }];
    const dedans = existante.parQui.includes(moi);
    const parQui = dedans ? existante.parQui.filter((q) => q !== moi) : [...existante.parQui, moi];
    return parQui.length === 0
      ? etat.filter((r) => r.emoji !== emoji)
      : etat.map((r) => (r.emoji === emoji ? { emoji, parQui } : r));
  });

  function reagir(emoji: string) {
    setChoixOuvert(false);
    demarrer(async () => {
      basculer({ emoji });
      await actionReagir(entreeId, emoji);
    });
  }

  const nom = (id: string) => annuaire.profils.find((p) => p.id === id)?.pseudo ?? "quelqu'un";

  return (
    <div className="border-t border-trait px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {vue.map((r) => {
          const mienne = r.parQui.includes(moi);
          return (
            <button
              key={r.emoji}
              type="button"
              onClick={() => reagir(r.emoji)}
              aria-pressed={mienne}
              title={r.parQui.map(nom).join(", ")}
              className={`inline-flex items-center gap-1 rounded-[var(--radius-pilule)] border px-2 py-1 text-[13px] transition ${
                mienne ? "border-encre-3 bg-surface-3" : "border-trait bg-surface-2 hover:border-trait-fort"
              }`}
            >
              {r.emoji}
              <span className="chiffres text-[12px] text-encre-2">{r.parQui.length}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setChoixOuvert((o) => !o)}
          aria-expanded={choixOuvert}
          aria-label="Ajouter une réaction"
          className="inline-grid h-[27px] w-[27px] place-items-center rounded-full border border-trait bg-surface-2 text-encre-3 transition hover:border-trait-fort hover:text-encre-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          aria-expanded={ouvert}
          className="ml-auto text-[12px] text-encre-3 transition hover:text-encre-2"
        >
          {commentaires.length === 0
            ? "Commenter"
            : `${commentaires.length} commentaire${commentaires.length > 1 ? "s" : ""}`}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {choixOuvert && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="mt-2 flex flex-wrap gap-1"
          >
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => reagir(emoji)}
                className="rounded-xl px-2 py-1 text-[19px] transition hover:bg-surface-2"
              >
                {emoji}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {ouvert && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="overflow-hidden"
          >
            <FilCommentaires
              entreeId={entreeId}
              commentaires={commentaires}
              annuaire={annuaire}
              moi={moi}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const LONGUEUR_MAX = 280;

function FilCommentaires({
  entreeId,
  commentaires,
  annuaire,
  moi,
}: {
  entreeId: string;
  commentaires: Commentaire[];
  annuaire: Annuaire;
  moi: string;
}) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const [texte, setTexte] = useState("");
  const champ = useRef<HTMLTextAreaElement>(null);

  function envoyer(donnees: FormData) {
    demarrer(async () => {
      const resultat = await actionCommenter(ETAT_INITIAL, donnees);
      setEtat(resultat);
      if (!resultat.erreur) {
        setTexte("");
        champ.current?.focus();
      }
    });
  }

  const restants = LONGUEUR_MAX - texte.length;

  return (
    <div className="pt-3">
      <ul className="space-y-2.5">
        {commentaires.map((c) => {
          const profil = annuaire.profils.find((p) => p.id === c.auteurId);
          return (
            <li key={c.id} className="flex items-start gap-2.5">
              {profil ? (
                <Avatar profil={profil} taille={26} />
              ) : (
                <span className="h-[26px] w-[26px] shrink-0 rounded-full bg-surface-2" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-snug">
                  <span className="font-semibold tracking-tight">{c.auteur}</span>{" "}
                  <span className="text-encre-2">{c.texte}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-[11px] text-encre-3">
                  <span>{c.quand}</span>
                  {c.auteurId === moi && (
                    <button
                      type="button"
                      onClick={() => demarrer(async () => { await actionSupprimerCommentaire(c.id); })}
                      className="underline underline-offset-2 transition hover:text-encre-2"
                    >
                      supprimer
                    </button>
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <form action={envoyer} className={commentaires.length ? "mt-3" : ""}>
        <input type="hidden" name="entree" value={entreeId} />
        <label htmlFor={`c-${entreeId}`} className="sr-only">
          Répondre à cette journée
        </label>
        <textarea
          ref={champ}
          id={`c-${entreeId}`}
          name="texte"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          rows={2}
          maxLength={LONGUEUR_MAX}
          placeholder="Répondre…"
          className="w-full resize-none rounded-2xl border border-trait bg-surface-2 px-3 py-2 text-[14px] placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
        />
        <div className="mt-1.5 flex items-center gap-3">
          {/* Le compteur n'apparaît qu'à l'approche de la limite : affiché en
              permanence, il transforme une note en exercice. */}
          {restants <= 40 && (
            <span className={`chiffres text-[12px] ${restants <= 0 ? "text-encre" : "text-encre-3"}`}>
              {restants}
            </span>
          )}
          {etat.erreur && <span role="alert" className="text-[12px] text-encre-2">{etat.erreur}</span>}
          <button
            type="submit"
            disabled={enCours || !texte.trim()}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="ml-auto rounded-[var(--radius-pilule)] px-4 py-1.5 text-[13px] font-semibold transition disabled:opacity-40"
          >
            {enCours ? "…" : "Envoyer"}
          </button>
        </div>
      </form>
    </div>
  );
}
