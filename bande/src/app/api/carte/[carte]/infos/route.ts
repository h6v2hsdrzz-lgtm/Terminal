import { NextResponse } from "next/server";

import { imageDeCarte } from "@/lib/jeux/contenu/images";
import { membreConnecte } from "@/lib/session";

/**
 * Ce qu'on sait d'une carte avant de montrer son image.
 *
 * L'écran a besoin de trois choses : y a-t-il une image, quelle forme a-t-elle,
 * et à qui la créditer. Rien de tout ça ne peut voyager dans un `<img>` — d'où
 * cette route minuscule, appelée une fois par carte et gardée un an par le
 * navigateur.
 *
 * L'alternative était d'embarquer la table entière dans le paquet du
 * navigateur : cinq cents entrées, cent kilo-octets, pour en lire une par
 * manche. Un aller-retour de trois cents octets est moins cher, et il garde la
 * table du côté où elle est engendrée.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ carte: string }> }) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const { carte } = await params;
  const image = imageDeCarte(decodeURIComponent(carte));
  if (!image) return new NextResponse(null, { status: 404 });

  return NextResponse.json(
    {
      largeur: image.largeur,
      hauteur: image.hauteur,
      auteur: image.auteur,
      licence: image.licence,
      page: image.page,
    },
    { headers: { "Cache-Control": "private, max-age=31536000, immutable" } },
  );
}
