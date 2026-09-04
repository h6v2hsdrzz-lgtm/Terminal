import { NextResponse } from "next/server";

import { chargerContexte, exporter, versCsv } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/** `?format=csv` pour un tableur, sinon du JSON complet. */
export async function GET(requete: Request) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const contexte = await chargerContexte(membreId);
  if (!contexte) return new NextResponse(null, { status: 401 });

  const donnees = await exporter(contexte.groupe.id);
  const csv = new URL(requete.url).searchParams.get("format") === "csv";
  // Le nom du fichier passe par l'en-tête : un accent ou une virgule dans le
  // nom de la bande casserait la forme simple, d'où la variante étoilée.
  const base = `journal-de-joie-${donnees.exporteLe.slice(0, 10)}`;

  return new NextResponse(csv ? versCsv(donnees) : JSON.stringify(donnees, null, 2), {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.${csv ? "csv" : "json"}"`,
      "Cache-Control": "no-store",
    },
  });
}
