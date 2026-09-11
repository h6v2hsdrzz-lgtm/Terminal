"use client";

import { useSyncExternalStore } from "react";

import { Carte, TitreSection } from "./Carte";

/**
 * Le thème : clair, sombre, ou celui du téléphone.
 *
 * ## Pourquoi ça vit dans le navigateur et pas en base
 *
 * Le thème est un réglage d'APPAREIL, pas de personne : le même compte ouvert
 * sur un téléphone posé sur la table de nuit et sur un ordinateur en plein jour
 * n'a pas la même bonne réponse. Il reste donc dans `localStorage`, et il ne
 * traverse jamais le réseau.
 *
 * ## Pourquoi `useSyncExternalStore` et pas un effet
 *
 * `localStorage` n'existe pas pendant le rendu serveur, et le lire dans un effet
 * pour poser un état, c'est un rendu de plus et une règle de lint enfreinte —
 * à raison. `useSyncExternalStore` dit exactement ce qui se passe : une valeur
 * vit dehors, voici comment la lire, et voici comment savoir qu'elle a changé.
 * Le troisième argument donne la réponse du serveur, « auto », qui est aussi
 * celle du premier rendu client — donc aucune divergence d'hydratation.
 *
 * ## Pourquoi le script est dans le document, avant tout le reste
 *
 * Sans lui (voir `layout.tsx`), la page s'affiche d'abord dans le thème du
 * système puis bascule quand React se réveille : un éclair blanc à minuit, et
 * l'application est rangée dans les choses qui font mal aux yeux.
 */
const CHOIX = [
  { cle: "auto", nom: "Le téléphone décide" },
  { cle: "clair", nom: "Toujours clair" },
  { cle: "sombre", nom: "Toujours sombre" },
] as const;

type Choix = (typeof CHOIX)[number]["cle"];

/**
 * Les abonnés au changement de thème.
 *
 * `localStorage` prévient les AUTRES onglets par l'événement `storage`, jamais
 * celui qui écrit. Sans cette liste, le bouton qu'on vient de toucher resterait
 * affiché comme non choisi jusqu'au prochain rendu.
 */
const abonnes = new Set<() => void>();

function sAbonner(rappel: () => void): () => void {
  abonnes.add(rappel);
  window.addEventListener("storage", rappel);
  return () => {
    abonnes.delete(rappel);
    window.removeEventListener("storage", rappel);
  };
}

function lire(): Choix {
  try {
    const garde = localStorage.getItem("joie-theme");
    return garde === "clair" || garde === "sombre" ? garde : "auto";
  } catch {
    // Navigation privée, stockage plein : on retombe sur le thème du système.
    return "auto";
  }
}

export function appliquerTheme(choix: Choix) {
  const racine = document.documentElement;
  racine.classList.remove("clair", "sombre");
  if (choix !== "auto") racine.classList.add(choix);
  try {
    if (choix === "auto") localStorage.removeItem("joie-theme");
    else localStorage.setItem("joie-theme", choix);
  } catch {
    // Le thème ne se souviendra pas d'une session à l'autre. L'application
    // marche, elle oublie juste.
  }
  for (const rappel of abonnes) rappel();
}

export function BoiteTheme() {
  const choix = useSyncExternalStore(sAbonner, lire, () => "auto" as Choix);

  return (
    <section className="mt-7">
      <TitreSection>L&apos;apparence</TitreSection>
      <Carte className="divide-y divide-trait">
        {CHOIX.map((option) => (
          <button
            key={option.cle}
            type="button"
            onClick={() => appliquerTheme(option.cle)}
            aria-pressed={choix === option.cle}
            className="cible-tactile flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
          >
            <span className="text-[15px]">{option.nom}</span>
            <span
              aria-hidden
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                choix === option.cle ? "border-encre bg-encre" : "border-trait-fort"
              }`}
            >
              {choix === option.cle && <span className="h-1.5 w-1.5 rounded-full bg-surface" />}
            </span>
          </button>
        ))}
      </Carte>
      <p className="mt-2 px-1 text-[12px] leading-snug text-encre-3">
        Ce réglage reste sur cet appareil. Ton téléphone et ton ordinateur peuvent
        avoir deux réponses différentes, et c&apos;est très bien.
      </p>
    </section>
  );
}
