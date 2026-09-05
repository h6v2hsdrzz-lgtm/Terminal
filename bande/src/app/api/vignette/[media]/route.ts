import { NextResponse } from "next/server";

import { lireMedia } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/**
 * Sert la vignette d'un média.
 *
 * Le fil et la galerie n'affichent jamais l'original : une image de mille
 * quatre cents pixels dans une case de cent soixante fait payer à celui qui lit
 * une résolution qu'il ne verra pas, et pour une vidéo ce serait le fichier
 * entier téléchargé pour montrer une image fixe.
 *
 * Les photos posées avant l'arrivée des vignettes n'en ont pas. Plutôt qu'un
 * 404 et une case vide, on sert l'original : c'est plus lourd, mais l'écran est
 * juste. Cette route n'a donc jamais besoin de savoir si la vignette existe.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ media: string }> }) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const { media } = await params;
  const fichier = (await lireMedia(membreId, media, true)) ?? (await lireMedia(membreId, media));
  if (!fichier) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(fichier.octets), {
    headers: {
      "Content-Type": fichier.mime,
      "Content-Length": String(fichier.octets.byteLength),
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
