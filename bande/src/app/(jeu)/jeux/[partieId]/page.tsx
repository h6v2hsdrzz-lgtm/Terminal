import { notFound } from "next/navigation";

import { JeuEnCours } from "@/composants/jeux/JeuEnCours";
import { Podium } from "@/composants/jeux/Podium";
import { cartesDeLaBande, chargerPartie, recompensesDe } from "@/lib/depot-jeux";
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
