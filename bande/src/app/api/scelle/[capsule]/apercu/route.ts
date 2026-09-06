import { NextResponse } from "next/server";

import { lireScelle } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";
import { jourDeLaBande } from "@/lib/dates";

/**
 * Sert l'aperçu d'un scellé, avant même son ouverture.
 *
 * C'est tout l'intérêt du sablier : on voit qu'il y a quelque chose, on ne voit
 * pas quoi. L'image servie ici est **déjà floutée dans ses octets**, réduite à
 * une trentaine de pixels de côté au moment de la fabrication, dans le
 * navigateur. Envoyer l'image nette et la flouter en CSS reviendrait à la
 * donner et à demander poliment de ne pas regarder — c'est exactement l'erreur
 * que le voile du fil a déjà coûtée une fois.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ capsule: string }> }) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const { capsule } = await params;
  const fichier = await lireScelle(membreId, capsule, jourDeLaBande(), true);
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
