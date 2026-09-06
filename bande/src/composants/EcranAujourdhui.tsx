"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { Avatar } from "./Avatar";
import { Carte, TitreSection } from "./Carte";
import { CarteEntree } from "./CarteEntree";
import { BoiteMedias } from "./BoiteMedias";
import { BoiteVocale } from "./BoiteVocale";
import { ChampEtiquettes } from "./ChampEtiquettes";
import { CurseurDiscret } from "./CurseurDiscret";
import { FigureDuJour } from "./FigureDuJour";
import { LienSceller } from "./PileScelles";
import { CurseurJoie } from "./CurseurJoie";
import { MessageErreur } from "./Champ";
import { VisageJoie } from "./VisageJoie";
import { actionPoserJournee, actionPoserJourneeSimple } from "@/lib/actions";
import { RESSORT, retard } from "@/lib/mouvement";
import { figure, lireFigure } from "@/lib/figure";
import { ETAT_INITIAL } from "@/lib/formulaire";
import { garderEnAttente, lireEnAttente, oublierAttente, sAbonnerAttente, yaUneAttente } from "@/lib/attente";
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
  entreesDuJour,
  serieCollective,
  revelerApresPost,
  etiquettesConnues,
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
}) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const [maJoie, setMaJoie] = useState(monEntree?.joie ?? 7);
  const formulaire = useRef<HTMLFormElement>(null);
  // Une journée se corrige : on s'est trompé d'un cran, on a oublié la note.
  // Le formulaire réapparaît prérempli, et l'envoi remplace la ligne du jour.
  const [correction, setCorrection] = useState(false);

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
          setCorrection(false);
          formulaire.current?.reset();
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

  // Sous le voile, les notes des autres valent zéro — elles ont été vidées par
  // le serveur. Il n'y a donc pas de moyenne à calculer, et l'écran n'en
  // affiche pas non plus.
  const moyenne = voile || entreesDuJour.length === 0
    ? null
    : entreesDuJour.reduce((s, e) => s + e.joie, 0) / entreesDuJour.length;

  const manquants = annuaire.profils.filter(
    (p) => !entreesDuJour.some((e) => e.profil === p.id),
  );

  /**
   * La figure du jour.
   *
   * Sous le voile, les entrées reçues ont été vidées par le serveur : les
   * valeurs de cette table ne veulent rien dire, et `masquee` les fait ignorer.
   * Ce n'est donc pas un flou par-dessus des notes envoyées, c'est un dessin
   * fait sans elles.
   */
  const notes = new Map<string, number | null>(
    annuaire.profils.map((p) => [p.id, entreesDuJour.find((e) => e.profil === p.id)?.joie ?? null]),
  );
  const lectureFigure = voile
    ? null
    : lireFigure(figure([...notes].map(([profil, joie]) => ({ profil, joie })), 100));

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
              <form ref={formulaire} action={actionPoserJourneeSimple} onSubmit={intercepter}>
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
            <Carte className="p-5">
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
              <LienSceller />
            </Carte>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── La bande ────────────────────────────────────────────────── */}
      <section className="mt-7">
        <TitreSection>La bande</TitreSection>
        <Carte className="p-4">
          <div className="flex items-center gap-4">
            {/* La figure du jour. Sous le voile elle n'est pas floutée : elle est
                dessinée sans les notes, qui ne descendent donc pas dans la page. */}
            <FigureDuJour
              profils={annuaire.profils}
              notes={notes}
              taille={158}
              masquee={voile}
              presents={entreesDuJour.map((e) => e.profil)}
            />

            <div className="min-w-0 flex-1">
              {!voile && moyenne !== null ? (
                <>
                  <div className="flex items-baseline gap-1">
                    <span className="chiffres text-[32px]" style={{ color: "var(--joie-encre)" }}>
                      {moyenne.toFixed(1).replace(".", ",")}
                    </span>
                    <span className="text-[12px] text-encre-3">/ 10</span>
                  </div>
                  <p className="text-[12px] text-encre-3">humeur du jour</p>
                  {lectureFigure && (
                    <p className="mt-2 text-[13px] leading-snug text-encre-2">{lectureFigure}</p>
                  )}
                </>
              ) : (
                <p className="text-[13px] leading-snug text-encre-3">
                  {voile
                    ? entreesDuJour.length > 0
                      ? "Les sommets vides sont ceux qui ont posé. Ils se remplissent quand tu poses la tienne."
                      : "La figure du jour se dessine quand tu as posé la tienne."
                    : "Personne n'a encore posé sa journée."}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 border-t border-trait pt-3">
            {annuaire.profils.map((profil) => {
              const aPoste = entreesDuJour.some((e) => e.profil === profil.id);
              // Avant d'avoir posé, savoir qui a déjà posté est une information
              // neutre : ça ne dit rien de leur journée, seulement qu'ils sont
              // passés. C'est le chiffre qu'on cache, pas la présence.
              return (
                <div key={profil.id} className="flex flex-col items-center gap-1.5">
                  <Avatar profil={profil} taille={40} anneau={aPoste} attenue={!aPoste} />
                  <span className={`text-[12px] ${aPoste ? "text-encre-2" : "text-encre-3"}`}>
                    {profil.id === moi.id ? "toi" : profil.pseudo}
                  </span>
                </div>
              );
            })}
          </div>

          {manquants.length > 0 && (
            <p className="mt-3 text-[13px] text-encre-3">
              {phraseManquants(manquants, moi.id)}
            </p>
          )}
        </Carte>
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
