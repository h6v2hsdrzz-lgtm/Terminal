import { NextResponse } from "next/server";

import { lireAvatar } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/**
 * Sert la photo de profil d'un membre de sa propre bande.
 *
 * Une tête n'est pas plus publique qu'une photo de journée : il faut une
 * session, et appartenir à la même bande. Même réponse pour « pas de photo » et
 * « pas ta bande » — distinguer les deux dirait qui existe ailleurs.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ membre: string }> }) {
  const moi = await membreConnecte();
  if (!moi) return new NextResponse(null, { status: 401 });

  const { membre } = await params;
  const octets = await lireAvatar(moi, membre);
  if (!octets) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(octets), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(octets.byteLength),
      // Court : une photo de profil change rarement, mais quand elle change on
      // veut la voir. L'empreinte de synchronisation prévient les autres, le
      // cache ne doit pas les faire attendre une heure de plus.
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": "inline",
    },
  });
}
