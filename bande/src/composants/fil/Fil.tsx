"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { AnimatePresence, motion } from "motion/react";

import { CarteEntree } from "../CarteEntree";
import { Carte } from "../Carte";
import { MenuCarte } from "./MenuCarte";
import { FiltresFil } from "./FiltresFil";
import { actionPageDuFil } from "@/lib/actions";
import { enTexteRelatif } from "@/lib/dates";
import { RESSORT } from "@/lib/mouvement";
import type { Annuaire, Entree, FiltreFil, PageFil } from "@/lib/types";

/**
 * Le fil, côté navigateur.
 *
 * Il était rendu entièrement sur le serveur, ce qui était bien tant qu'on
 * affichait douze journées et rien d'autre. La pagination, les filtres et le
 * menu par appui long demandent tous de l'état côté client : le fil devient
 * donc un composant client, et c'est le serveur qui lui passe la première page
 * déjà voilée.
 *
 * **Le voile ne bouge pas d'un pouce.** Ce composant ne reçoit jamais le
 * contenu d'une journée masquée : le serveur l'a vidée avant de sérialiser
 * (`masquerEntree`), et l'action qui charge la suite le refait. Rendre côté
 * client n'ouvre donc aucune fenêtre — c'est la donnée qui est absente, pas
 * seulement son affichage.
 */
export type JourneeFil = { jour: string; entrees: Entree[] };

const TOUT: FiltreFil = { genre: "tout" };

export function Fil({
  premierePage,
  annuaire,
  moi,
  bande,
  aujourdhui,
  masques,
  depuisVisite,
}: {
  premierePage: PageFil;
  annuaire: Annuaire;
  moi: string;
  /** Le nom de la bande — il n'apparaît que sur l'image de partage. */
  bande: string;
  aujourdhui: string;
  /** Les entrées voilées de la première page — la carte doit le savoir. */
  masques: string[];
  /** L'instant de la visite précédente, ou `null` la toute première fois. */
  depuisVisite: string | null;
}) {
  const [filtre, setFiltre] = useState<FiltreFil>(TOUT);
  const [pages, setPages] = useState<JourneeFil[]>(premierePage.journees);
  const [curseur, setCurseur] = useState<string | null>(premierePage.curseur);
  const [enCours, demarrer] = useTransition();
  const [fini, setFini] = useState(premierePage.curseur === null);
  const [enAttente, setEnAttente] = useState<JourneeFil[] | null>(null);

  const voiles = useMemo(() => new Set(masques), [masques]);
  const enHaut = !useDepasse(120);

  /**
   * L'arrivée d'une nouveauté ne doit pas faire sauter le défilement.
   *
   * Le sondage de `Synchronisation` rafraîchit la page dès que la bande écrit
   * quelque chose, et une journée insérée en haut pousse tout le reste vers le
   * bas — on perd la ligne qu'on était en train de lire.
   *
   * D'où deux empreintes, et pas une :
   *
   * · **la structure** — quelles journées, quelles entrées. Elle change quand
   *   quelqu'un pose sa journée : c'est ce qui décale le fil, donc c'est le
   *   seul cas qui mérite une pastille plutôt qu'une insertion ;
   * · **le détail** — épingles, réactions, commentaires, **et le contenu de la
   *   journée elle-même**. Ça change à l'endroit même où l'on vient d'agir,
   *   sans rien décaler : on applique tout de suite. Sans cette deuxième
   *   empreinte, la carte qu'on vient d'épingler continue de proposer
   *   « épingler ».
   *
   *   Le contenu en fait partie depuis l'audit du lot R, et ce n'était pas
   *   théorique : quand quelqu'un **corrigeait** sa journée — un titre, une
   *   note, une photo ajoutée — l'empreinte ne bougeait pas d'un caractère.
   *   La version de la bande, elle, changeait ; le serveur refaisait donc son
   *   rendu, et le fil décidait qu'il n'y avait rien de neuf. Les deux autres
   *   téléphones gardaient l'ancienne version jusqu'au prochain rechargement.
   *   Trouvé en jouant à trois, pas en lisant le code.
   *
   * L'ajustement se fait **pendant le rendu**, pas dans un effet : React
   * refait le rendu immédiatement, sans passer par le DOM, alors qu'un effet
   * afficherait d'abord l'ancienne liste puis la nouvelle. C'est aussi ce
   * qu'impose `react-hooks/set-state-in-effect`, et la règle a raison.
   */
  const structure = premierePage.journees
    .map((j) => `${j.jour}:${j.entrees.map((e) => e.id).join(",")}`)
    .join("|");
  const detail = premierePage.journees
    .flatMap((j) =>
      j.entrees.map(
        (e) =>
          `${e.id}${e.epingle ? "P" : ""}:${e.reactions.length}:${e.commentaires.length}` +
          // Ce qu'une correction peut changer. Sous le voile, ces champs sont
          // déjà vidés par le serveur : l'empreinte d'une journée masquée est
          // donc stable, et ne raconte rien de son contenu.
          `:${e.joie}:${e.titre ?? ""}:${e.note?.length ?? 0}` +
          `:${e.photos.length}${e.audio ? "V" : ""}:${e.etiquettes.length}:${e.declencheurs.length}`,
      ),
    )
    .join("|");

  const [structureVue, setStructureVue] = useState(structure);
  const [detailVue, setDetailVue] = useState(detail);

  // Un filtre actif regarde autre chose que ce que le serveur vient de rendre :
  // on ne lui écrase pas sa liste sous les pieds.
  const suitLeServeur = filtre.genre === "tout";

  if (structure !== structureVue) {
    setStructureVue(structure);
    setDetailVue(detail);
    if (suitLeServeur) {
      if (enHaut) appliquer(premierePage);
      else setEnAttente(premierePage.journees);
    }
  } else if (detail !== detailVue) {
    setDetailVue(detail);
    if (suitLeServeur) appliquer(premierePage);
  }

  /**
   * Remplace ce que le serveur vient de rendre, et garde le reste.
   *
   * Les pages chargées en défilant ne repassent pas par le serveur : les
   * écraser ferait disparaître cinquante journées parce que quelqu'un a mis
   * un cœur. On ne remplace donc que la tranche que la page couvre.
   */
  function appliquer(fraiche: PageFil) {
    const limite = fraiche.journees[fraiche.journees.length - 1]?.jour;
    setPages((avant) => {
      const dessous = limite ? avant.filter((j) => j.jour < limite) : [];
      return [...fraiche.journees, ...dessous];
    });
    setEnAttente(null);
    // Le curseur ne recule pas : il pointe sur la journée la plus ancienne
    // déjà affichée, pas sur celle de la première page.
    if (pages.length <= fraiche.journees.length) {
      setCurseur(fraiche.curseur);
      setFini(fraiche.curseur === null);
    }
  }

  function appliquerAttente() {
    if (!enAttente) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    appliquer(premierePage);
  }

  const changerFiltre = useCallback((neuf: FiltreFil) => {
    setFiltre(neuf);
    setEnAttente(null);
    demarrer(async () => {
      const page = await actionPageDuFil(null, neuf);
      setPages(page.journees);
      setCurseur(page.curseur);
      setFini(page.curseur === null);
      window.scrollTo({ top: 0 });
    });
  }, []);

  const chargerSuite = useCallback(() => {
    if (fini || enCours || curseur === null) return;
    demarrer(async () => {
      const page = await actionPageDuFil(curseur, filtre);
      // Concaténer sans dédoublonner ferait réapparaître une journée quand une
      // entrée est ajoutée pendant le défilement : la clé de React protégerait
      // l'affichage, pas la moyenne du jour.
      setPages((avant) => {
        const connus = new Set(avant.map((j) => j.jour));
        return [...avant, ...page.journees.filter((j) => !connus.has(j.jour))];
      });
      setCurseur(page.curseur);
      setFini(page.curseur === null);
    });
  }, [curseur, filtre, fini, enCours]);

  // La sentinelle : un bloc vide en bas de liste. Quand il entre dans le champ
  // — 400 px avant, pour que la page suivante soit déjà là — on charge.
  const sentinelle = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cible = sentinelle.current;
    if (!cible || fini) return;
    const guetteur = new IntersectionObserver(
      (entrees) => {
        if (entrees.some((e) => e.isIntersecting)) chargerSuite();
      },
      { rootMargin: "400px" },
    );
    guetteur.observe(cible);
    return () => guetteur.disconnect();
  }, [chargerSuite, fini]);

  /**
   * Le repère « nouveau depuis ta dernière visite ».
   *
   * Il se pose une seule fois, après la dernière entrée plus récente que la
   * visite précédente — le fil descend dans le temps, donc tout ce qui est
   * nouveau est en haut. Ses propres journées ne comptent pas : on n'a rien à
   * rattraper de soi-même.
   */
  const dernierNouveau = useMemo(() => {
    if (!depuisVisite) return null;
    let trouve: string | null = null;
    for (const journee of pages) {
      for (const entree of journee.entrees) {
        if (entree.profil !== moi && entree.creeA > depuisVisite) trouve = entree.id;
      }
    }
    return trouve;
  }, [pages, depuisVisite, moi]);

  const vide = pages.every((j) => j.entrees.length === 0);

  return (
    <>
      <FiltresFil
        valeur={filtre}
        profils={annuaire.profils}
        moi={moi}
        onChange={changerFiltre}
      />

      <AnimatePresence>
        {enAttente && (
          <motion.button
            type="button"
            onClick={appliquerAttente}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={RESSORT.vif}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="fixed inset-x-0 top-3 z-40 mx-auto w-fit rounded-[var(--radius-pilule)] px-4 py-2 text-[13px] font-semibold shadow-[var(--ombre-2)]"
          >
            ↑ Du nouveau dans le fil
          </motion.button>
        )}
      </AnimatePresence>

      {vide ? (
        <Carte className="p-5">
          <p className="text-[15px] leading-snug text-encre-2">
            {filtre.genre === "tout"
              ? "Rien encore. Le fil se remplira tout seul, une journée à la fois."
              : "Rien ne correspond à ce filtre. Essaie « Tout »."}
          </p>
        </Carte>
      ) : (
        <div className="space-y-7">
          {pages.map((journee) => (
            <JourneeDuFil
              key={journee.jour}
              journee={journee}
              annuaire={annuaire}
              moi={moi}
              bande={bande}
              aujourdhui={aujourdhui}
              voiles={voiles}
              apresQuoi={dernierNouveau}
            />
          ))}
        </div>
      )}

      <div ref={sentinelle} aria-hidden className="h-px" />

      {enCours && (
        <p role="status" className="py-6 text-center text-[13px] text-encre-3">
          Chargement…
        </p>
      )}
      {fini && !vide && (
        <p className="py-8 text-center text-[13px] text-encre-3">
          C&apos;est tout. Le début du fil.
        </p>
      )}

      <RetourEnHaut />
    </>
  );
}

function JourneeDuFil({
  journee,
  annuaire,
  moi,
  bande,
  aujourdhui,
  voiles,
  apresQuoi,
}: {
  journee: JourneeFil;
  annuaire: Annuaire;
  moi: string;
  bande: string;
  aujourdhui: string;
  voiles: Set<string>;
  apresQuoi: string | null;
}) {
  // La moyenne ne se calcule que sur ce qu'on a le droit de lire. Compter les
  // journées masquées donnerait « 0,0 de moyenne », ce qui ne cache rien et
  // laisse croire à une journée épouvantable.
  const lisibles = journee.entrees.filter((e) => !voiles.has(e.id));
  const moyenne = lisibles.length
    ? lisibles.reduce((s, e) => s + e.joie, 0) / lisibles.length
    : null;

  return (
    <section>
      {/* L'en-tête colle en haut pendant le défilement : sur un fil de cent
          journées, savoir quel jour on lit vaut mieux que remonter pour voir.
          Le fond est opaque, pas translucide — un flou laisse passer le texte
          des cartes qui défilent dessous et rend la date illisible. */}
      <div
        // `top` suit la zone sûre : en mode application installée, la page
        // passe sous l'encoche, et une date collée à zéro se retrouverait sous
        // l'heure du téléphone.
        style={{ top: "env(safe-area-inset-top)" }}
        className="sticky z-20 -mx-4 mb-3 bg-sol px-5 py-2"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
            {enTexteRelatif(journee.jour, aujourdhui)}
          </h2>
          {moyenne !== null && (
            <span className="chiffres text-[13px] text-encre-3">
              {moyenne.toFixed(1).replace(".", ",")} de moyenne
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {journee.entrees.map((entree) => (
          <div key={entree.id}>
            <MenuCarte
              entree={entree}
              annuaire={annuaire}
              moi={moi}
              bande={bande}
              // Pas de menu sur une carte voilée : rien à partager, rien à
              // épingler, et réagir à ce qu'on n'a pas lu n'a aucun sens.
              actif={!voiles.has(entree.id)}
            >
              <CarteEntree
                entree={entree}
                annuaire={annuaire}
                moi={voiles.has(entree.id) ? undefined : moi}
                floute={voiles.has(entree.id)}
              />
            </MenuCarte>
            {entree.id === apresQuoi && <RepereVisite />}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Un trait et trois mots : tout ce qui est au-dessus est arrivé depuis. */
function RepereVisite() {
  return (
    <div className="flex items-center gap-3 pt-4" aria-label="Nouveau depuis ta dernière visite">
      <span className="h-px flex-1 bg-trait-fort" aria-hidden />
      <span className="text-[11px] uppercase tracking-[0.08em] text-encre-3">
        depuis ta dernière visite
      </span>
      <span className="h-px flex-1 bg-trait-fort" aria-hidden />
    </div>
  );
}

/**
 * La position du défilement, en booléen.
 *
 * Un abonnement plutôt qu'un effet qui écrit l'état, et un **booléen** plutôt
 * qu'un nombre de pixels : rendre à chaque pixel de défilement sur un fil de
 * cent journées se voit tout de suite sur un téléphone. Le rendu serveur, lui,
 * répond « non » — il n'a pas de fenêtre, et la page arrive en haut.
 */
function abonnerDefilement(rappel: () => void) {
  window.addEventListener("scroll", rappel, { passive: true });
  window.addEventListener("resize", rappel, { passive: true });
  return () => {
    window.removeEventListener("scroll", rappel);
    window.removeEventListener("resize", rappel);
  };
}

function useDepasse(seuil: number | "deux-écrans"): boolean {
  return useSyncExternalStore(
    abonnerDefilement,
    () => window.scrollY > (seuil === "deux-écrans" ? 2 * window.innerHeight : seuil),
    () => false,
  );
}

/** Après deux écrans de défilement, un bouton pour remonter. */
function RetourEnHaut() {
  const visible = useDepasse("deux-écrans");

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={RESSORT.vif}
          aria-label="Revenir en haut du fil"
          // Au-dessus de la barre d'onglets, jamais dessous : la zone sûre du
          // bas d'un iPhone mange déjà trente points.
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+84px)] right-4 z-30 grid h-12 w-12 place-items-center rounded-full border border-trait bg-surface text-encre-2 shadow-[var(--ombre-2)] lg:bottom-8"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
