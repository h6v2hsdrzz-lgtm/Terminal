import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { chargerContexte, listerEntrees } from "./depot";
import { membreConnecte } from "./session";
import type { Contexte } from "./depot";

/**
 * Le point d'entrée des écrans du repaire.
 *
 * `cache` est là pour une raison précise : la disposition contrôle la session,
 * puis la page relit le même contexte. Sans mémoïsation, chaque affichage
 * ferait deux fois la même requête. Le cache ne vit que le temps d'une
 * requête HTTP — rien n'est partagé entre deux visiteurs.
 */
export const contexteCourant = cache(async (): Promise<Contexte | null> => {
  const membreId = await membreConnecte();
  return membreId ? chargerContexte(membreId) : null;
});

export async function exigerContexte(): Promise<Contexte> {
  const contexte = await contexteCourant();
  if (!contexte) redirect("/bienvenue");
  return contexte;
}

export const entreesDeLaBande = cache(async (groupeId: string, depuis?: string) =>
  listerEntrees(groupeId, depuis),
);
