"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "./Avatar";
import { Carte } from "./Carte";
import { actionChercher } from "@/lib/actions";
import { enTexteLongAvecAnnee } from "@/lib/dates";
import { TROUVAILLES_MAX, motsDe, surligner } from "@/lib/recherche";
import type { Annuaire, Trouvaille } from "@/lib/types";

/**
 * Chercher dans le journal.
 *
 * ## Trois cents millisecondes
 *
 * Pas de bouton « chercher » : on tape, ça cherche. Mais pas à chaque frappe —
 * « anniversaire » ferait treize allers-retours, dont douze jetés. Le délai
 * repart à chaque touche ; taper vite ne lance donc qu'une seule recherche.
 *
 * ## Le dernier arrivé n'est pas forcément le bon
 *
 * Deux recherches en vol peuvent revenir dans le désordre : « pl » après
 * « pluie » afficherait les résultats de « pl » sous le mot « pluie ». Chaque
 * requête porte donc un numéro, et une réponse plus vieille que la dernière
 * affichée est jetée.
 */
export function Recherche({ annuaire, moi, aujourdhui }: {
  annuaire: Annuaire;
  moi: string;
  aujourdhui: string;
}) {
  const [requete, setRequete] = useState("");
  /**
   * Les résultats **avec la requête qui les a produits**.
   *
   * C'est ce qui permet de savoir, pendant le rendu, si ce qu'on affiche
   * correspond encore à ce qui est tapé — donc d'afficher « on cherche… »
   * sans poser d'état dans un effet. La règle `react-hooks/set-state-in-effect`
   * refuse le raccourci, et elle a raison : un `setState` synchrone dans un
   * effet, c'est un rendu de plus à chaque frappe.
   */
  const [resultat, setResultat] = useState<{ requete: string; liste: Trouvaille[] } | null>(null);
  const numero = useRef(0);
  const affiche = useRef(0);

  const mots = motsDe(requete);
  const propre = requete.trim();
  const cherche = mots.length > 0 && resultat?.requete !== propre;
  const trouvailles = mots.length === 0 || resultat?.requete !== propre ? null : resultat.liste;

  useEffect(() => {
    if (motsDe(requete).length === 0) return;

    const attente = setTimeout(async () => {
      numero.current += 1;
      const mien = numero.current;
      const reponse = await actionChercher(requete);
      // Une réponse doublée par une plus récente ne doit pas la remplacer.
      if (mien < affiche.current) return;
      affiche.current = mien;
      setResultat({ requete: requete.trim(), liste: reponse.valeur ?? [] });
    }, 300);

    return () => clearTimeout(attente);
  }, [requete]);

  return (
    <>
      {/* `bg-sol` et pas `bg-surface` : le fond de la page est `--sol`, et une
          barre collante en `--surface` dessine une bande blanche en travers de
          l'écran. Vu sur une capture — c'est la même couleur que le fil emploie
          pour son en-tête de date. */}
      <div className="sticky top-0 z-20 -mx-4 bg-sol/95 px-4 pb-3 backdrop-blur">
        <label htmlFor="recherche" className="sr-only">
          Chercher dans le journal
        </label>
        <input
          id="recherche"
          type="search"
          value={requete}
          onChange={(evenement) => setRequete(evenement.target.value)}
          placeholder="Un mot, un lieu, un prénom…"
          autoComplete="off"
          // On vient ici pour taper, pas pour regarder un champ.
          autoFocus
          className="champ-saisie w-full rounded-[var(--radius-pilule)] border border-trait bg-surface-2 px-4 py-3 outline-none transition focus:border-trait-fort"
        />
      </div>

      {cherche ? (
        <Carte className="p-5">
          <p role="status" className="text-[15px] leading-snug text-encre-3">
            On cherche…
          </p>
        </Carte>
      ) : trouvailles === null ? (
        <Carte className="p-5">
          <p className="text-[15px] leading-snug text-encre-2">
            Tout ce que la bande a écrit : les journées, les commentaires, les
            légendes des photos, les lieux. Deux lettres suffisent.
          </p>
        </Carte>
      ) : trouvailles.length === 0 ? (
        <Carte className="p-5">
          <p role="status" className="text-[15px] leading-snug text-encre-2">
            Rien pour «&nbsp;{propre}&nbsp;».
          </p>
        </Carte>
      ) : (
        <>
          <p role="status" className="mb-2 px-1 text-[13px] text-encre-3">
            {/* Le plafond se dit. « 60 résultats » sur une recherche qui en a
                deux cents est un chiffre faux. */}
            {trouvailles.length >= TROUVAILLES_MAX
              ? `Les ${TROUVAILLES_MAX} plus récents`
              : `${trouvailles.length} résultat${trouvailles.length > 1 ? "s" : ""}`}
          </p>
          <ul className="space-y-2">
            {trouvailles.map((trouvaille, rang) => (
              <li key={`${trouvaille.entreeId}-${trouvaille.ou}-${rang}`}>
                <Resultat
                  trouvaille={trouvaille}
                  mots={mots}
                  annuaire={annuaire}
                  moi={moi}
                  aujourdhui={aujourdhui}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

const OU: Record<Trouvaille["ou"], string> = {
  journee: "dans la journée",
  commentaire: "en commentaire",
  legende: "sous une photo",
  etiquette: "dans une étiquette",
};

function Resultat({
  trouvaille,
  mots,
  annuaire,
  moi,
  aujourdhui,
}: {
  trouvaille: Trouvaille;
  mots: string[];
  annuaire: Annuaire;
  moi: string;
  aujourdhui: string;
}) {
  const profil = annuaire.profils.find((p) => p.id === trouvaille.profil);
  const auteur = annuaire.profils.find((p) => p.id === trouvaille.parQui);

  return (
    <Link href={`/jour/${trouvaille.jour}#entree-${trouvaille.entreeId}`} className="block">
      <Carte className="p-3.5 transition hover:border-trait-fort">
        <div className="flex items-center gap-2 text-[12px] text-encre-3">
          {profil && <Avatar profil={profil} taille={20} />}
          <span>
            {trouvaille.profil === moi ? "toi" : (profil?.pseudo ?? "quelqu'un")}
            {" · "}
            {enTexteLongAvecAnnee(trouvaille.jour, aujourdhui)}
          </span>
          <span className="ml-auto shrink-0">
            {OU[trouvaille.ou]}
            {auteur && trouvaille.parQui !== trouvaille.profil
              ? ` de ${auteur.id === moi ? "toi" : auteur.pseudo}`
              : ""}
          </span>
        </div>

        {trouvaille.titre && (
          <p className="mt-1.5 text-[15px] font-semibold leading-tight tracking-tight">
            <Morceaux texte={trouvaille.titre} mots={mots} />
          </p>
        )}

        {trouvaille.extrait && (
          <p
            className={`text-[15px] leading-snug ${trouvaille.titre ? "mt-1 text-encre-2" : "mt-1.5"}`}
          >
            <Morceaux texte={trouvaille.extrait} mots={mots} />
          </p>
        )}
      </Carte>
    </Link>
  );
}

/** Le texte, avec les mots trouvés dans un `<mark>` — que les lecteurs d'écran annoncent. */
function Morceaux({ texte, mots }: { texte: string; mots: string[] }) {
  return (
    <>
      {surligner(texte, mots).map((morceau, i) =>
        morceau.fort ? (
          <mark key={i} className="rounded-[3px] bg-surface-3 px-0.5 text-encre">
            {morceau.texte}
          </mark>
        ) : (
          <span key={i}>{morceau.texte}</span>
        ),
      )}
    </>
  );
}
