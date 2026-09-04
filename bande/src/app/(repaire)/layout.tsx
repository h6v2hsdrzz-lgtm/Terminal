import { redirect } from "next/navigation";

import { BarreOnglets } from "@/composants/BarreOnglets";
import { Synchronisation } from "@/composants/Synchronisation";
import { chargerContexte, versionBande } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/**
 * Le repaire : les quatre écrans qu'on ne voit qu'une fois dans une bande.
 *
 * Le contrôle est ici plutôt que dans chaque page — un écran oublié serait un
 * écran qui plante faute de contexte, et la garde vaut mieux placée une fois
 * pour toutes.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const membreId = await membreConnecte();
  if (!membreId) redirect("/bienvenue");

  // Le cookie peut survivre à la personne : bande supprimée, base réinitialisée.
  const contexte = await chargerContexte(membreId);
  if (!contexte) redirect("/bienvenue");

  return (
    <>
      <Synchronisation version={await versionBande(contexte.groupe.id)} />
      <div className="mx-auto min-h-dvh w-full max-w-lg marge-basse">{children}</div>
      <BarreOnglets />
    </>
  );
}
