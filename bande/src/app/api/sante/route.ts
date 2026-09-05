import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

/**
 * Une route de santé : la base répond-elle ?
 *
 * Elle ne dit rien d'autre. Pas de compte de bandes, pas de nom, pas de
 * version de schéma — une sonde publique n'a aucune raison de renseigner un
 * curieux sur ce que contient la base. Juste de quoi savoir, depuis
 * l'extérieur, si l'application est vraiment reliée à son stockage ou
 * seulement capable d'afficher une page d'accueil.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // La requête la plus légère qui prouve un aller-retour complet.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ base: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Le détail de l'erreur reste dans les journaux : il contient l'hôte et
    // parfois l'utilisateur de la base.
    return NextResponse.json(
      { base: "injoignable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
