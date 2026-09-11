import { notFound } from "next/navigation";

import { JeuEnCours } from "@/composants/jeux/JeuEnCours";
import { Podium } from "@/composants/jeux/Podium";
import { Salon } from "@/composants/jeux/Salon";
import { cartesDeLaBande, chargerPartie, lireEtatPartie, recompensesDe } from "@/lib/depot-jeux";
import { jeuParCle } from "@/lib/jeux/catalogue";
import { entreesDeLaBande, exigerContexte } from "@/lib/repaire";

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
  }

  /**
   * Deux jeux se nourrissent du journal. Les journées sont chargées ici, une
   * fois, plutôt que par chaque jeu : le chargement d'une partie ne doit pas
   * dépendre du jeu choisi, et deux allers-retours de plus au lancement se
   * voient quand trois personnes attendent autour d'une table.
   */
  const seNourritDuJournal = jeu.cle === "quiz-bande" || jeu.cle === "qui-a-ecrit";

  return (
    <JeuEnCours
      partie={partie}
      jeu={jeu}
      cartesMaison={jeu.cle === "devine-qui" ? await cartesDeLaBande(contexte.moi.id) : []}
      entrees={seNourritDuJournal ? await entreesDeLaBande(contexte.groupe.id) : []}
      profils={contexte.profils}
    />
  );
}
