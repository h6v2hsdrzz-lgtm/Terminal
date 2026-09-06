import { redirect } from "next/navigation";

/**
 * Les statistiques ont rejoint les souvenirs.
 *
 * Elles y sont mieux : c'est l'écran où l'on vient regarder en arrière, et un
 * onglet dédié en faisait une destination alors qu'elles sont une lecture. La
 * redirection reste parce que l'ancienne adresse est dans des raccourcis
 * d'écran d'accueil.
 */
export default function Page() {
  redirect("/souvenirs#stats");
}
