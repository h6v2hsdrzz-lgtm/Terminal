import Link from "next/link";
import { redirect } from "next/navigation";

import { VisageJoie } from "@/composants/VisageJoie";
import { membreConnecte } from "@/lib/session";

export default async function Page() {
  // Revenir ici avec une session valide n'a pas de sens : on est déjà dans une
  // bande.
  if (await membreConnecte()) redirect("/");

  return (
    <main>
      <div className="mb-8 flex flex-col items-center text-center">
        <VisageJoie valeur={8} taille={84} />
        <h1 className="mt-5 text-[30px] font-semibold leading-tight tracking-[-0.02em]">
          Une joie par jour,
          <br />à trois ou à sept.
        </h1>
        <p className="mt-3 max-w-[22rem] text-[15px] leading-snug text-encre-2">
          Dix secondes le soir : une note de 1 à 10, ce qui a fait la journée. Les
          journées des autres se dévoilent quand tu as posé la tienne.
        </p>
      </div>

      <div className="space-y-3">
        <Link
          href="/bienvenue/creer"
          style={{ background: "var(--encre)", color: "var(--surface)" }}
          className="block rounded-[var(--radius-pilule)] py-3.5 text-center text-[15px] font-semibold transition active:scale-[0.99]"
        >
          Créer une bande
        </Link>
        <Link
          href="/bienvenue/rejoindre"
          className="block rounded-[var(--radius-pilule)] border border-trait-fort bg-surface py-3.5 text-center text-[15px] font-semibold transition hover:border-encre-3 active:scale-[0.99]"
        >
          Rejoindre avec un code
        </Link>
      </div>

      <p className="mt-8 text-center text-[13px] text-encre-3">
        Déjà dans une bande, sur un autre téléphone ?{" "}
        <Link href="/reprendre" className="font-medium text-encre-2 underline underline-offset-2">
          Retrouver son compte
        </Link>
      </p>
    </main>
  );
}
