import { NextResponse } from "next/server";

import { chargerContexte, versionBande } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/**
 * L'empreinte de l'état de la bande, sondée par le client.
 *
 * C'est le mécanisme de temps réel, et il tient en une ligne : quand
 * l'empreinte change, le client demande à Next de refaire le rendu. Pas de
 * WebSocket, pas de service tiers, pas de connexion à maintenir ouverte — ce
 * qui compte à trois personnes, c'est que la journée de l'autre apparaisse en
 * quelques secondes, pas en quelques millisecondes.
 */
export async function GET() {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const contexte = await chargerContexte(membreId);
  if (!contexte) return new NextResponse(null, { status: 401 });

  return NextResponse.json(
    { version: await versionBande(contexte.groupe.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
