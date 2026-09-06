import { NextResponse } from "next/server";

import { lireScelle } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";
import { jourDeLaBande } from "@/lib/dates";

/**
 * Sert le contenu d'un scellé — une fois la date venue, et pas avant.
 *
 * Le contrôle de date est ici, dans le dépôt, et pas dans l'écran : une adresse
 * se tape à la main, et un scellé qu'on peut rouvrir en devinant une URL n'est
 * pas un scellé. Il vaut même pour celui qui l'a écrit.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ capsule: string }> }) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const { capsule } = await params;
  const fichier = await lireScelle(membreId, capsule, jourDeLaBande());
  if (!fichier) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(fichier.octets), {
    headers: {
      "Content-Type": fichier.mime,
      "Content-Length": String(fichier.octets.byteLength),
      "Accept-Ranges": "none",
      // Court, et c'est délibéré : un scellé change d'état à une date précise,
      // et personne ne doit rester devant un 404 mis en cache la veille.
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": "inline",
    },
  });
}
