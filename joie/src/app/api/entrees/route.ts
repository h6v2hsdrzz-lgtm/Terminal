import { NextResponse } from "next/server";

import { enregistrerEntree, listerEntrees, versionJournal } from "@/lib/depot";
import { validerSaisie } from "@/lib/validation";

// Prisma et SQLite ont besoin du runtime Node, et le journal change à chaque
// saisie : rien à mettre en cache ici.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [entrees, version] = await Promise.all([listerEntrees(), versionJournal()]);
  return NextResponse.json(
    { entrees, version },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(requete: Request) {
  let brut: unknown;
  try {
    brut = await requete.json();
  } catch {
    return NextResponse.json({ message: "Corps de requête illisible." }, { status: 400 });
  }

  const resultat = validerSaisie(brut);
  if (!resultat.ok) {
    return NextResponse.json(
      { message: "Saisie invalide.", erreurs: resultat.erreurs },
      { status: 422 },
    );
  }

  const entree = await enregistrerEntree(resultat.valeur);
  return NextResponse.json({ entree }, { status: 201 });
}
