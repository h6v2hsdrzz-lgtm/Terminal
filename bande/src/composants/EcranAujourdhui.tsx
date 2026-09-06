"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { Carte, TitreSection } from "./Carte";
import { CarteEntree } from "./CarteEntree";
import { BoiteMedias } from "./BoiteMedias";
import { BoiteVocale } from "./BoiteVocale";
import { ChampEtiquettes } from "./ChampEtiquettes";
import { CurseurDiscret } from "./CurseurDiscret";
import { BoitePouls } from "./BoitePouls";
import { BoutonSceller } from "./BoutonSceller";
import { GraphiquePouls } from "./GraphiquePouls";
import type { Cadre, Pouls } from "@/lib/pouls";
import { CurseurJoie } from "./CurseurJoie";
import { MessageErreur } from "./Champ";
import { VisageJoie } from "./VisageJoie";
import { actionPoserJournee, actionPoserJourneeSimple } from "@/lib/actions";
import { RESSORT, retard } from "@/lib/mouvement";
import { ETAT_INITIAL } from "@/lib/formulaire";
import { garderEnAttente, lireEnAttente, oublierAttente, sAbonnerAttente, yaUneAttente } from "@/lib/attente";
import { garderBrouillon, lireBrouillon, oublierBrouillon } from "@/lib/brouillon";
import { enTexteLong } from "@/lib/dates";
import { couleurProfil } from "@/lib/couleurs";
import type { Annuaire, Entree, Etiquette, Profil } from "@/lib/types";

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

export function EcranAujourdhui({
  jour,
  nomBande,
  annuaire,
  moi,
  monEntree,
  entreesDuJour,
  serieCollective,
  revelerApresPost,
  etiquettesConnues,
  pouls,
  dernierPouls,
  joursSemaine,
  cadrePouls,
}: {
  jour: string;
  nomBande: string;
  annuaire: Annuaire;
  moi: Profil;
  monEntree: Entree | null;
  /** Toutes les journées du jour, la mienne comprise. */
  entreesDuJour: Entree[];
  serieCollective: number;
  revelerApresPost: boolean;
  /** Celles que la bande a déjà posées, pour les proposer plutôt que les faire retaper. */
  etiquettesConnues: Etiquette[];
  /** Les pouls de la bande sur les sept derniers jours. */
  pouls: Pouls[];
  /** Le dernier pouls de la personne, pour préremplir les curseurs. */
  dernierPouls: { rire: number; energie: number } | null;
  /** Les sept derniers jours, du plus ancien au plus récent. */
  joursSemaine: string[];
  cadrePouls: Cadre;
}) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const [maJoie, setMaJoie] = useState(monEntree?.joie ?? 7);
  const formulaire = useRef<HTMLFormElement>(null);
  // Une journée se corrige : on s'est trompé d'un cran, on a oublié la note.
  // Le formulaire réapparaît prérempli, et l'envoi remplace la ligne du jour.
  const [correction, setCorrection] = useState(false);
  // Vrai le temps de l'onde de validation, et seulement après un envoi réussi :
  // rouvrir l'écran demain ne doit pas rejouer la confirmation d'aujourd'hui.
  const [vientDePoser, setVientDePoser] = useState(false);

  /**
   * L'attente se lit dans le stockage local, elle n'est pas recopiée dans un
   * état.
   *
   * C'est un système extérieur à React : le recopier obligerait à le
   * resynchroniser dans un effet à chaque écriture, et à choisir quoi rendre
   * pendant l'hydratation. L'instantané côté serveur vaut faux — le serveur ne
   * sait rien de ce téléphone.
   */
  const enAttente = useSyncExternalStore(
    sAbonnerAttente,
    () => yaUneAttente(jour),
    () => false,
  );

  const poste = monEntree !== null && !correction;

  /**
   * On appelle l'action à la main plutôt que par `useActionState`.
   *
   * Deux raisons. Il faut refermer le formulaire de correction quand — et
   * seulement quand — l'envoi a réussi ; un état qui ne distingue pas « rien
   * envoyé » de « envoyé sans erreur » ne le permet pas. Et il faut pouvoir
   * rattraper l'échec réseau pour garder la journée sur l'appareil.
   */
  const poser = useCallback(
    async (donnees: FormData) => {
      try {
        const resultat = await actionPoserJournee(ETAT_INITIAL, donnees);
        setEtat(resultat);
        if (!resultat.erreur) {
          oublierAttente();
          oublierBrouillon();
          setCorrection(false);
          formulaire.current?.reset();
          setVientDePoser(true);
          setTimeout(() => setVientDePoser(false), 900);
          if ("vibrate" in navigator) navigator.vibrate(18);
        }
        return !resultat.erreur;
      } catch {
        // Une action serveur qui échoue au transport, c'est le réseau. On garde
        // la journée sur l'appareil plutôt que de la perdre, et on la renverra.
        garderEnAttente({
          jour,
          joie: Number(donnees.get("joie")) || 7,
          note: String(donnees.get("note") ?? ""),
          declencheurs: donnees.getAll("declencheurs").map(String),
          titre: String(donnees.get("titre") ?? ""),
          etiquettes: String(donnees.get("etiquettes") ?? "").split(",").filter(Boolean),
          // `null` et pas zéro : le curseur auquel on n'a pas touché n'a pas de
          // valeur, et zéro en serait une.
          energie: donnees.get("energie") === null ? null : Number(donnees.get("energie")),
          calme: donnees.get("calme") === null ? null : Number(donnees.get("calme")),
        });
        setEtat({ erreur: null });
        return false;
      }
    },
    [jour],
  );

  /**
   * Le formulaire vise une vraie action serveur, et on l'intercepte quand le
   * navigateur sait exécuter du JavaScript.
   *
   * Sans cette interception, on perdrait la mise en attente hors ligne ; sans
   * l'action serveur derrière, le formulaire ne partirait pas du tout quand le
   * JavaScript n'a pas chargé. Les deux chemins mènent à la même écriture.
   */
  function intercepter(evenement: React.FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    const donnees = new FormData(evenement.currentTarget);
    demarrer(async () => { await poser(donnees); });
  }
  // Le voile suit ce que le serveur a réellement masqué, pas l'état local du
  // formulaire : corriger sa journée ne doit pas re-flouter celles des autres,
  // qui sont déjà arrivées en clair.
  const voile = revelerApresPost && monEntree === null;

  /**
   * Le brouillon, en continu.
   *
   * Les champs ne sont pas contrôlés, et on ne les rend pas contrôlés pour
   * autant : réécrire un formulaire qui marche pour ajouter une sauvegarde
   * serait exactement le refactor que le plan interdit. On écoute la saisie sur
   * le FORMULAIRE — un seul écouteur, qui voit tout ce qui bouge dedans — et on
   * range ce que `FormData` en dit.
   *
   * La relecture se fait dans un effet, pas au premier rendu : `localStorage`
   * n'existe pas sur le serveur, et le lire pendant le rendu produirait
   * exactement le désaccord d'hydratation qu'on vient de corriger ailleurs.
   */
  useEffect(() => {
    if (correction || monEntree) return;
    const garde = lireBrouillon(jour);
    if (!garde) return;
    const form = formulaire.current;
    if (!form) return;
    const poser = (nom: string, valeur: string) => {
      const champ = form.elements.namedItem(nom);
      if (champ instanceof HTMLInputElement || champ instanceof HTMLTextAreaElement) {
        // On n'écrase jamais ce qui est déjà tapé : le brouillon comble, il ne
        // remplace pas.
        if (champ.value === "") champ.value = valeur;
      }
    };
    poser("titre", garde.titre);
    poser("note", garde.note);
    // Le curseur de joie n'est PAS restauré, et c'est volontaire : c'est le
    // seul champ qui a toujours une valeur, il se règle d'un geste, et ce
    // n'est pas lui qu'on perd en quittant l'écran. Le brouillon rattrape les
    // mots — c'est ce qu'on ne réécrit pas.
  }, [correction, monEntree, jour]);

  function noterBrouillon() {
    const form = formulaire.current;
    if (!form || correction) return;
    const donnees = new FormData(form);
    const texte = (cle: string) => String(donnees.get(cle) ?? "");
    garderBrouillon({
      jour,
      joie: Number(donnees.get("joie") ?? maJoie),
      titre: texte("titre"),
      note: texte("note"),
      lieu: texte("etiquettes"),
      energie: donnees.get("energie") ? Number(donnees.get("energie")) : null,
      rire: donnees.get("calme") ? Number(donnees.get("calme")) : null,
      declencheurs: donnees.getAll("declencheurs").map(String),
    });
  }

  /**
   * Le renvoi de la journée gardée hors ligne.
   *
   * Il se déclenche au montage et au retour du réseau, pas sur un minuteur :
   * réessayer toutes les dix secondes dans un tunnel ne fait que vider la
   * batterie.
   */
  useEffect(() => {
    // `enAttente` est dans les dépendances, et ce n'est pas cosmétique : sans
    // lui, l'effet ne tourne qu'au montage. Une journée écrite APRÈS le montage
    // — le cas exact du métro : on ouvre l'application avec du réseau, on le
    // perd, on écrit — n'aurait jamais eu d'écouteur « online », et serait
    // restée sur l'appareil jusqu'au rechargement suivant.
    if (!enAttente) return;

    const renvoyer = async () => {
      const encore = lireEnAttente(jour);
      if (!encore) return;
      const donnees = new FormData();
      donnees.set("joie", String(encore.joie));
      donnees.set("note", encore.note);
      for (const d of encore.declencheurs) donnees.append("declencheurs", d);
      // Ce qui a été écrit dans le métro part en entier : perdre le titre au
      // renvoi serait pire que d'avoir refusé l'écriture.
      donnees.set("titre", encore.titre ?? "");
      donnees.set("etiquettes", (encore.etiquettes ?? []).join(","));
      if (encore.energie != null) donnees.set("energie", String(encore.energie));
      if (encore.calme != null) donnees.set("calme", String(encore.calme));
      await poser(donnees);
    };

    renvoyer();
    window.addEventListener("online", renvoyer);
    return () => window.removeEventListener("online", renvoyer);
  }, [enAttente, jour, poser]);

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

      {enAttente && !poste && (
        <p
          role="status"
          className="mb-4 rounded-2xl border border-trait-fort bg-surface-2 px-4 py-3 text-[14px] leading-snug text-encre-2"
        >
          Ta journée est écrite et gardée sur ce téléphone. Elle partira toute seule
          dès que le réseau revient.
        </p>
      )}

      {/* ── Le check-in, ou ce qu'on vient d'écrire ─────────────────── */}
      <AnimatePresence mode="wait" initial={false}>
        {!poste ? (
          <motion.div
            key="saisie"
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={RESSORT.moyen}
          >
            <Carte className="p-5">
              <form
                ref={formulaire}
                action={actionPoserJourneeSimple}
                onSubmit={intercepter}
                // Un seul écouteur pour tout le formulaire : il voit le titre,
                // l'anecdote, les curseurs, les déclencheurs et le lieu.
                onInput={noterBrouillon}
                onChange={noterBrouillon}
              >
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
                    {correction ? "Corriger ta journée" : "Ta journée"}
                  </p>
                  {correction && (
                    <button
                      type="button"
                      onClick={() => setCorrection(false)}
                      className="text-[13px] text-encre-3 underline underline-offset-2 hover:text-encre-2"
                    >
                      laisser comme ça
                    </button>
                  )}
                </div>

                <CurseurJoie nom="joie" valeurInitiale={maJoie} onChange={setMaJoie} />

                <fieldset className="mt-5">
                  <legend className="sr-only">Ce qui a marqué la journée</legend>
                  <div className="flex flex-wrap gap-2">
                    {annuaire.declencheurs.map((d) => (
                      <PuceDeclencheur
                        key={d.id}
                        emoji={d.emoji}
                        nom={d.nom}
                        valeur={d.id}
                        coche={correction && (monEntree?.declencheurs.includes(d.id) ?? false)}
                      />
                    ))}
                  </div>
                </fieldset>

                {/* Le titre, avant la note. C'est ce qu'on relira dans un an :
                    trois mots retiennent une journée mieux qu'un paragraphe. */}
                <label htmlFor="titre" className="sr-only">
                  Le titre de la journée, en trois mots
                </label>
                <input
                  id="titre"
                  name="titre"
                  type="text"
                  defaultValue={correction ? (monEntree?.titre ?? "") : ""}
                  maxLength={60}
                  autoComplete="off"
                  placeholder="En trois mots… (facultatif)"
                  className="champ-saisie mt-5 w-full rounded-2xl border border-trait bg-surface-2 px-3.5 py-3 font-medium placeholder:font-normal placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
                />

                <label htmlFor="note" className="sr-only">
                  L&apos;anecdote
                </label>
                <textarea
                  id="note"
                  name="note"
                  defaultValue={correction ? (monEntree?.note ?? "") : ""}
                  rows={2}
                  maxLength={280}
                  placeholder="L'anecdote du jour… (facultatif)"
                  className="champ-saisie mt-2.5 w-full resize-none rounded-2xl border border-trait bg-surface-2 px-3.5 py-3 placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
                />

                <ChampEtiquettes
                  proposees={etiquettesConnues}
                  initiales={correction ? (monEntree?.etiquettes.map((e) => e.nom) ?? []) : []}
                />

                {/* Repliés par défaut, et c'est délibéré : le rituel du soir
                    doit tenir en un curseur et un bouton. Ce qui est en dessous
                    est pour les soirs où on a envie d'en dire plus. */}
                {/* `group` et `group-open` : le chevron pivote à l'ouverture.
                    Sans lui, le dépliant fermé se lit comme un troisième champ
                    de saisie vide — c'est ce que montrait la capture iPhone. */}
                <details className="group mt-4 rounded-2xl border border-trait px-3.5 py-2.5">
                  <summary className="cible-tactile flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-encre-2 marker:hidden">
                    <svg
                      width="10" height="10" viewBox="0 0 10 10" aria-hidden
                      className="shrink-0 transition-transform duration-[var(--duree-courte)] group-open:rotate-90"
                    >
                      <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Énergie et rire
                  </summary>
                  <div className="mt-2 border-t border-trait pt-2">
                    <CurseurDiscret
                      nom="energie"
                      etiquette="Énergie"
                      bas="vidé"
                      haut="à fond"
                      valeurInitiale={correction ? (monEntree?.energie ?? null) : null}
                    />
                    <CurseurDiscret
                      nom="calme"
                      etiquette="Rire"
                      bas="pas trop"
                      haut="plié en deux"
                      valeurInitiale={correction ? (monEntree?.calme ?? null) : null}
                    />
                    <p className="mt-1 text-[12px] leading-snug text-encre-3">
                      Ni l&apos;un ni l&apos;autre n&apos;entre dans une moyenne ou un classement.
                      C&apos;est pour relire, plus tard.
                    </p>
                  </div>
                </details>

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
                  {enCours ? "Un instant…" : correction ? "Corriger" : "Poser ma joie du jour"}
                </button>
              </form>
            </Carte>
          </motion.div>
        ) : (
          <motion.div
            key="posee"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={RESSORT.moyen}
          >
            <Carte className="relative overflow-hidden p-5">
              {/**
                * Le retour de validation.
                *
                * Jusqu'ici, poser sa journée ne faisait que changer un texte —
                * et un texte qui change dans une carte qu'on vient de remplir
                * ne se remarque pas : on cherche si ça a marché. Une onde qui
                * traverse la carte une fois se voit sans rien lire, et elle ne
                * revient pas quand on rouvre l'écran plus tard.
                */}
              {vientDePoser && (
                <motion.span
                  aria-hidden
                  initial={{ x: "-110%" }}
                  animate={{ x: "110%" }}
                  transition={{ duration: 0.85, ease: "easeOut" }}
                  className="pointer-events-none absolute inset-y-0 w-1/2"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, var(--joie-haut), transparent)",
                    opacity: 0.5,
                  }}
                />
              )}
              <div className="flex items-center gap-4">
                <VisageJoie valeur={monEntree.joie} taille={64} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">C&apos;est posé pour aujourd&apos;hui.</p>
                  <button
                    type="button"
                    onClick={() => { setMaJoie(monEntree.joie); setCorrection(true); }}
                    className="mt-0.5 text-[13px] text-encre-3 underline underline-offset-2 transition hover:text-encre-2"
                  >
                    corriger ta journée
                  </button>
                </div>
                <span className="chiffres shrink-0 text-[30px]" style={{ color: "var(--joie-encre)" }}>
                  {monEntree.joie}
                </span>
              </div>
              {(monEntree.titre || monEntree.etiquettes.length > 0) && (
                <div className="mt-3 border-t border-trait pt-3">
                  {monEntree.titre && (
                    <p className="text-[17px] font-semibold leading-tight tracking-[-0.01em]">
                      {monEntree.titre}
                    </p>
                  )}
                  {monEntree.etiquettes.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {monEntree.etiquettes.map((e) => (
                        <li
                          key={e.id}
                          className="rounded-[var(--radius-pilule)] bg-surface-3 px-2 py-0.5 text-[12px] text-encre-2"
                        >
                          {e.nom}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <BoiteMedias medias={monEntree.photos} />
              <BoiteVocale audio={monEntree.audio} couleur={couleurProfil(moi)} />
              <BoutonSceller aujourdhui={jour} />
            </Carte>
          </motion.div>
        )}
      </AnimatePresence>

      {/**
        * ── Le pouls de la bande ─────────────────────────────────────────
        *
        * À la place de la bulle « La bande », qui redisait ce que la figure du
        * jour montre déjà — et la figure, elle, est en tête du FIL, qui est la
        * première page. La répéter ici occupait un demi-écran pour rien.
        *
        * À la place : deux curseurs pour poser un pouls, et la courbe qu'ils
        * remplissent. C'est la seule chose de cet écran qui change plusieurs
        * fois dans la journée.
        */}
      <section className="mt-7">
        <TitreSection>Le pouls</TitreSection>
        <Carte className="mb-2.5 p-4">
          <p className="mb-3 text-[13px] leading-snug text-encre-3">
            Deux curseurs, deux taps, autant de fois que tu veux dans la journée.
            Ça ne remplace pas ta journée et ça ne rapporte aucun point.
          </p>
          <BoitePouls dernier={dernierPouls} />
        </Carte>
        <GraphiquePouls
          pouls={pouls}
          profils={annuaire.profils}
          aujourdhui={jour}
          jours={joursSemaine}
          cadreInitial={cadrePouls}
        />
      </section>

      {/* ── Le fil du jour ──────────────────────────────────────────── */}
      <section className="mt-7">
        <TitreSection>Aujourd&apos;hui</TitreSection>

        {entreesDuJour.length === 0 ? (
          <Carte className="p-5">
            <p className="text-[14px] leading-snug text-encre-2">
              {poste
                ? "Tu es le premier ce soir. Les autres arriveront."
                : "Personne n'a encore posé sa journée. Ouvre le bal."}
            </p>
          </Carte>
        ) : (
          <div className="relative space-y-3">
            {entreesDuJour.map((entree, index) => (
              <motion.div
                key={entree.id}
                initial={false}
                animate={{ opacity: 1 }}
                transition={{ delay: voile ? 0 : retard(index), ...RESSORT.moyen }}
              >
                {/* Ma propre journée n'est jamais floutée : le voile protège
                    le jugement des autres, pas le mien. */}
                <CarteEntree
                  entree={entree}
                  annuaire={annuaire}
                  moi={moi.id}
                  floute={voile && entree.profil !== moi.id}
                />
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
function PuceDeclencheur({
  emoji,
  nom,
  valeur,
  coche = false,
}: {
  emoji: string;
  nom: string;
  valeur: string;
  coche?: boolean;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="checkbox"
        name="declencheurs"
        value={valeur}
        defaultChecked={coche}
        className="peer sr-only"
      />
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
