import { NextResponse } from "next/server";

import { lireMedia } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/**
 * Sert un média dans sa taille d'origine — photo ou vidéo.
 *
 * Il n'est jamais public : il faut une session, et appartenir à la même bande.
 * C'est pour ça qu'il passe par une route plutôt que par un fichier statique —
 * un fichier servi depuis `public/` serait lisible par quiconque connaîtrait
 * son adresse.
 *
 * L'adresse dit `/api/photo/` alors qu'elle sert aussi des vidéos : elle est
 * déjà dans des pages en cache et dans des navigateurs, et la changer casserait
 * les images déjà affichées pour ne gagner qu'un mot plus juste.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ media: string }> }) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const { media } = await params;
  const fichier = await lireMedia(membreId, media);
  // Même réponse pour « n'existe pas » et « pas ta bande » : distinguer les
  // deux dirait quelles journées existent ailleurs.
  if (!fichier) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(fichier.octets), {
    headers: {
      "Content-Type": fichier.mime,
      "Content-Length": String(fichier.octets.byteLength),
      // Une vidéo se lit par plages : Safari demande un morceau avant de
      // commencer. On sert le fichier entier — il fait moins de quatre
      // méga-octets — mais il faut le dire, sinon le lecteur attend en vain.
      "Accept-Ranges": "none",
      // Privé : un média de bande n'a rien à faire dans un cache partagé.
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
