import { redirect } from "next/navigation";

import { BandeauReseau } from "@/composants/BandeauReseau";
import { chargerContexte } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/**
 * L'écran d'une partie, seul.
 *
 * Pas de barre d'onglets : un téléphone qu'on se passe, posé sur la table, avec
 * « Fil » et « Profil » à trois millimètres du pouce, c'est une partie qui
 * s'interrompt toutes les cinq minutes. On sort par « Terminer » ou par
 * « Abandonner », et c'est tout.
 *
 * Pas de sondage de synchronisation non plus : rien de ce qui se passe dans le
 * journal ne concerne une partie en cours, et un rafraîchissement au milieu
 * d'un chrono se voit.
 *
 * Le bandeau de réseau, si : une action de jeu qui ne part pas doit se voir ici
 * comme ailleurs. L'état du FLUX, lui, s'affiche dans l'écran de la partie —
 * « reconnexion… » près du nombre de joueurs — parce qu'il ne veut pas dire la
 * même chose qu'un geste perdu.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const membreId = await membreConnecte();
  if (!membreId) redirect("/bienvenue");
  if (!(await chargerContexte(membreId))) redirect("/bienvenue");

  return (
    <>
      <BandeauReseau />
      <div className="mx-auto w-full max-w-lg">{children}</div>
    </>
  );
}
