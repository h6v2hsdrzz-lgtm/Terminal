import { notFound } from "next/navigation";

import { JeuEnCours } from "@/composants/jeux/JeuEnCours";
import { Podium } from "@/composants/jeux/Podium";
import { CoquilleMulti } from "@/composants/jeux/multi/CoquilleMulti";
import { Salon } from "@/composants/jeux/Salon";
import { cartesDeLaBande, chargerPartie, lireEtatPartie, recompensesDe } from "@/lib/depot-jeux";
import { jeuParCle } from "@/lib/jeux/catalogue";
import { questionsDuQuiz } from "@/lib/jeux/quiz";
import { generateur } from "@/lib/jeux/tirage";
import { entreesDeLaBande, exigerContexte } from "@/lib/repaire";
import type { Entree, Profil } from "@/lib/types";

export default async function Page({ params }: { params: Promise<{ partieId: string }> }) {
  const contexte = await exigerContexte();
  const { partieId } = await params;

  // `chargerPartie` rend `null` pour une partie d'une autre bande comme pour
  // une partie qui n'existe pas : de l'extérieur, les deux cas doivent être
  // indiscernables.
  const partie = await chargerPartie(contexte.moi.id, partieId);
  if (!partie) notFound();

  const jeu = jeuParCle(partie.jeu);
  if (!jeu) notFound();

  // Une partie finie garde son podium. Rediriger vers la liste des jeux, comme
  // le faisait la première version, effaçait le classement à l'instant même où
  // la revalidation de fin de partie rafraîchissait la page.
  if (partie.finie) {
    return (
      <Podium joueurs={partie.joueurs} recompenses={(await recompensesDe(contexte.moi.id, partieId)) ?? []} />
    );
  }

  // Une partie à plusieurs téléphones commence par un salon : on y attend que
  // tout le monde soit là. Le mode « un seul téléphone » n'en a pas — il n'y a
  // personne à attendre, l'appareil est déjà dans la main.
  if (partie.mode === "multi") {
    const etat = await lireEtatPartie(contexte.moi.id, partieId);
    if (etat?.etat === "salon") {
      return (
        <Salon initial={etat} jeu={jeu} moi={contexte.moi.id} profils={contexte.profils} />
      );
    }
    if (etat) {
      // Le contenu tiré du journal est préparé ICI, sur le serveur : la recette
      // du jeu tourne dans le navigateur de l'hôte, et lui faire charger cinq
      // cents journées pour fabriquer une question coûterait plus cher que la
      // partie entière.
      const entrees = seNourritDuJournal(jeu.cle)
        ? await entreesDeLaBande(contexte.groupe.id)
        : [];
      return (
        <CoquilleMulti
          initial={etat}
          jeu={jeu}
          moi={contexte.moi.id}
          contexte={{
            cartesMaison:
              jeu.cle === "devine-qui"
                ? (await cartesDeLaBande(contexte.moi.id)).map((c) => c.texte)
                : [],
            niveaux: ["soft", "chaud"],
            duJournal: duJournal(jeu.cle, entrees, contexte.profils),
          }}
        />
      );
    }
  }

  return (
    <JeuEnCours
      partie={partie}
      jeu={jeu}
      cartesMaison={jeu.cle === "devine-qui" ? await cartesDeLaBande(contexte.moi.id) : []}
      entrees={seNourritDuJournal(jeu.cle) ? await entreesDeLaBande(contexte.groupe.id) : []}
      profils={contexte.profils}
    />
  );
}

/**
 * Deux jeux se nourrissent du journal. Les journées sont chargées une fois,
 * ici, plutôt que par chaque jeu : le chargement d'une partie ne doit pas
 * dépendre du jeu choisi, et deux allers-retours de plus au lancement se
 * voient quand trois personnes attendent autour d'une table.
 */
function seNourritDuJournal(cle: string): boolean {
  return cle === "quiz-bande" || cle === "qui-a-ecrit";
}

/**
 * Le contenu tiré du journal, ramené à la forme que les recettes attendent.
 *
 * Une question de quiz et un « qui a écrit ça » sont la même chose vue de la
 * recette : un énoncé, une bonne réponse, des options. Les fabriquer ici évite
 * d'envoyer tout le journal au navigateur.
 */
function duJournal(
  cle: string,
  entrees: Entree[],
  profils: Profil[],
): { enonce: string; reponse: string; options: string[] }[] {
  if (cle === "quiz-bande") {
    return questionsDuQuiz(entrees, profils, generateur(entrees.length + 17), 24).map((q) => ({
      enonce: q.intitule,
      reponse: q.bonne,
      options: q.options,
    }));
  }
  if (cle === "qui-a-ecrit") {
    // Une note assez longue pour avoir un style, et pas si longue qu'elle se
    // lise en diagonale. `flatMap` plutôt qu'un filtre suivi d'un `!` : c'est
    // le même code, et le compilateur n'a rien à croire sur parole.
    return entrees
      .flatMap((e) => ((e.note?.length ?? 0) > 25 && e.note ? [{ note: e.note, qui: e.profil }] : []))
      .slice(0, 40)
      .map((e) => ({
        enonce: e.note,
        reponse: e.qui,
        options: profils.map((p) => p.id),
      }));
  }
  return [];
}
