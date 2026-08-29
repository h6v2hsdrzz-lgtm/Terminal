import { NextResponse } from "next/server";

import { modifierEntree, supprimerEntree, trouverEntree } from "@/lib/depot";
import { validerSaisie } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Contexte = { params: Promise<{ id: string }> };

export async function PATCH(requete: Request, { params }: Contexte) {
  const { id } = await params;

  if (!(await trouverEntree(id))) {
    return NextResponse.json({ message: "Entrée introuvable." }, { status: 404 });
  }

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

  try {
    const entree = await modifierEntree(id, resultat.valeur);
    return NextResponse.json({ entree });
  } catch {
    // Seule erreur attendue ici : la contrainte d'unicité (jour, personne),
    // si la modification déplace l'entrée sur un couple déjà occupé.
    return NextResponse.json(
      {
        message: "Une entrée existe déjà pour cette personne à cette date.",
        erreurs: { date: "Déjà renseignée pour cette personne." },
      },
      { status: 409 },
    );
  }
}

export async function DELETE(_requete: Request, { params }: Contexte) {
  const { id } = await params;

  if (!(await trouverEntree(id))) {
    return NextResponse.json({ message: "Entrée introuvable." }, { status: 404 });
  }

  await supprimerEntree(id);
  return new NextResponse(null, { status: 204 });
}
