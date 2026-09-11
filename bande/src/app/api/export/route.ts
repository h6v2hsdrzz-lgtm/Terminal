import { NextResponse } from "next/server";

import { ecrireZip } from "@/lib/archive";
import { chargerContexte, exporter, sauvegarde, versCsv } from "@/lib/depot";
import { membreConnecte } from "@/lib/session";

/**
 * `?format=csv` pour un tableur, `?format=zip` pour **tout** — y compris les
 * photos et les vocaux — et du JSON complet sinon.
 *
 * Le ZIP est la seule des trois qui mérite le mot « sauvegarde » : un fichier
 * qui dit « 3 photos » sans les photos est un inventaire, et un inventaire ne
 * ramène rien le jour où la base disparaît.
 */
export async function GET(requete: Request) {
  const membreId = await membreConnecte();
  if (!membreId) return new NextResponse(null, { status: 401 });

  const contexte = await chargerContexte(membreId);
  if (!contexte) return new NextResponse(null, { status: 401 });

  const format = new URL(requete.url).searchParams.get("format");

  if (format === "zip") {
    const { nom, fichiers } = await sauvegarde(contexte.groupe.id);
    return new NextResponse(ecrireZip(fichiers), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${nom}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const donnees = await exporter(contexte.groupe.id);
  const csv = format === "csv";
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
