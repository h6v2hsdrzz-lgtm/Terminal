import { NextResponse } from "next/server";

import { lirePhoto } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/**
 * Sert la photo d'une journée.
 *
 * Elle n'est jamais publique : il faut une session, et appartenir à la même
 * bande. C'est pour ça qu'elle passe par une route plutôt que par un fichier
 * statique — un fichier servi depuis `public/` serait lisible par quiconque
 * connaîtrait son adresse.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ entree: string }> }) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const { entree } = await params;
  const photo = await lirePhoto(membreId, entree);
  // Même réponse pour « n'existe pas » et « pas ta bande » : distinguer les
  // deux dirait quelles journées existent ailleurs.
  if (!photo) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(photo.octets), {
    headers: {
      "Content-Type": photo.mime,
      "Content-Length": String(photo.octets.byteLength),
      // Privé : une photo de bande n'a rien à faire dans un cache partagé.
      // Immuable, parce que remplacer la photo change l'empreinte de version
      // et donc l'adresse interrogée au rafraîchissement suivant.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
