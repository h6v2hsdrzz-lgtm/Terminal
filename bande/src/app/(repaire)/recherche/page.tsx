import Link from "next/link";

import { Recherche } from "@/composants/Recherche";
import { jourDeLaBande } from "@/lib/dates";
import { exigerContexte } from "@/lib/repaire";

export const metadata = { title: "Chercher — Journal de joie" };

/**
 * Chercher dans le journal.
 *
 * Un écran à part et pas un champ dans le fil : chercher, c'est arrêter de
 * lire. Mettre le champ en haut du fil aurait coûté une ligne de hauteur à
 * chaque ouverture de l'application pour un geste qu'on fait une fois par
 * semaine.
 */
export default async function Page() {
  const contexte = await exigerContexte();

  return (
    <div className="px-4 pt-3">
      <header className="mb-4 zone-sure-haute">
        <Link href="/" className="mb-3 inline-block text-[14px] text-encre-3 hover:text-encre-2">
          ← Le fil
        </Link>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Chercher</h1>
      </header>

      <Recherche
        annuaire={{ profils: contexte.profils, declencheurs: contexte.declencheurs }}
        moi={contexte.moi.id}
        aujourdhui={jourDeLaBande()}
      />
    </div>
  );
}
