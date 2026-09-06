import { notFound } from "next/navigation";

import { JeuEnCours } from "@/composants/jeux/JeuEnCours";
import { Podium } from "@/composants/jeux/Podium";
import { chargerPartie, recompensesDe } from "@/lib/depot-jeux";
import { jeuParCle } from "@/lib/jeux/catalogue";
import { exigerContexte } from "@/lib/repaire";

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

  return <JeuEnCours partie={partie} jeu={jeu} />;
}
