import { NextResponse } from "next/server";

import { lireParole } from "@/lib/depot-jeux";
import { membreConnecte } from "@/lib/session";

/**
 * Sert une parole de jeu — une théorie du complot, un plaidoyer.
 *
 * Même contrat que les photos et les notes vocales : une session valide, et le
 * dépôt vérifie que la parole appartient bien à la bande de celui qui écoute.
 * Un identifiant deviné ne donne pas la soirée des voisins.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ parole: string }> }) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const { parole } = await params;
  const son = await lireParole(membreId, parole);
  if (!son) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(son.octets), {
    headers: {
      "Content-Type": son.mime,
      "Content-Length": String(son.octets.byteLength),
      // Une parole ne change jamais : le navigateur peut la garder, et une
      // réécoute ne doit pas retraverser le réseau.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": "inline",
    },
  });
}
