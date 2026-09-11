import { battreLeCoeur } from "@/lib/depot-jeux";
import { membreConnecte } from "@/lib/session";

/**
 * « Je suis là. »
 *
 * Une route plutôt qu'une action serveur : une action déclenche la
 * revalidation des chemins et un aller-retour de rendu, ce qui est beaucoup
 * pour écrire une date toutes les cinq secondes. Ici on touche une colonne et
 * on rend 204, sans réveiller personne — les absences se constatent à la
 * lecture, en comparant les dates.
 */
export const dynamic = "force-dynamic";

export async function POST(
  _requete: Request,
  { params }: { params: Promise<{ partie: string }> },
) {
  const membreId = await membreConnecte();
  if (!membreId) return new Response(null, { status: 401 });

  const { partie } = await params;
  await battreLeCoeur(membreId, partie);
  return new Response(null, { status: 204 });
}
