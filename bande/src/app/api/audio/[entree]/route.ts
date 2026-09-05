import { NextResponse } from "next/server";

import { lireAudio } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/**
 * Sert la note vocale d'une journée.
 *
 * Même règle que pour les photos : session obligatoire, même bande obligatoire.
 * Un fichier posé dans `public/` serait lisible par quiconque connaîtrait son
 * adresse, et une note vocale est ce qu'il y a de plus personnel dans une
 * journée.
 *
 * L'adresse porte l'identifiant de l'entrée, pas celui du son : une journée n'a
 * qu'une note vocale, et la réenregistrer remplace la précédente.
 */
export async function GET(_requete: Request, { params }: { params: Promise<{ entree: string }> }) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const { entree } = await params;
  const audio = await lireAudio(membreId, entree);
  // Même réponse pour « n'existe pas » et « pas ta bande ».
  if (!audio) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(audio.octets), {
    headers: {
      "Content-Type": audio.mime,
      "Content-Length": String(audio.octets.byteLength),
      // `Accept-Ranges` : Safari demande une plage avant de lire un son, et
      // répond par une erreur silencieuse si le serveur n'annonce rien. Le
      // fichier fait quelques dizaines de kilo-octets, on le sert entier.
      "Accept-Ranges": "none",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
