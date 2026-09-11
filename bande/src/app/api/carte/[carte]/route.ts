import { NextResponse } from "next/server";

import { imageDeCarte } from "@/lib/jeux/contenu/images";
import { membreConnecte } from "@/lib/session";

/**
 * Sert l'image d'une carte de « Devine qui je suis ».
 *
 * ## Pourquoi passer par nous
 *
 * L'image vit chez Wikimedia, et le plus simple serait de mettre son adresse
 * dans un `<img>`. Ce serait aussi dire à un tiers, image par image, ce que
 * trois personnes sont en train de jouer un samedi soir. « Rien ne sort de la
 * bande » vaut aussi pour ça : le téléphone ne parle qu'à nous, et c'est le
 * serveur — le même pour tout le monde, qui ne dit donc rien de personne — qui
 * va chercher l'octet.
 *
 * ## Pourquoi une CLÉ et pas une adresse
 *
 * La route prend le texte de la carte, jamais l'adresse de l'image, et elle lit
 * l'adresse dans une table engendrée. Une route qui accepterait une adresse
 * serait un relais ouvert : n'importe qui pourrait s'en servir pour faire
 * partir des requêtes depuis notre serveur, vers n'importe où.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ carte: string }> }) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const { carte } = await params;
  const image = imageDeCarte(decodeURIComponent(carte));
  if (!image) return new NextResponse(null, { status: 404 });

  const amont = await fetch(image.url, {
    headers: {
      "User-Agent": "JournalDeJoie/1.0 (application privée de trois amis) next-server",
      Accept: "image/webp,image/jpeg,image/png,*/*",
    },
    // Une image de Wikimedia ne change pas : le cache de la plateforme peut la
    // garder longtemps, et ça évite de retraverser l'Atlantique à chaque manche.
    cache: "force-cache",
  }).catch(() => null);

  if (!amont || !amont.ok || !amont.body) return new NextResponse(null, { status: 502 });

  const type = amont.headers.get("Content-Type") ?? "image/jpeg";
  if (!type.startsWith("image/")) return new NextResponse(null, { status: 502 });

  return new NextResponse(amont.body, {
    headers: {
      "Content-Type": type,
      // « private » : la réponse ne passe par aucun cache partagé, et le
      // navigateur la garde un an — l'adresse d'une carte ne change jamais.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": "inline",
    },
  });
}
