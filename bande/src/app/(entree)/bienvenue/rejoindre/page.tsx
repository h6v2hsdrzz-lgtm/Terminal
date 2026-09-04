import Link from "next/link";

import { FormulaireRejoindre } from "@/composants/FormulairesEntree";

export default function Page() {
  return (
    <main>
      <Link href="/bienvenue" className="mb-6 inline-block text-[14px] text-encre-3 hover:text-encre-2">
        ← Retour
      </Link>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Rejoindre une bande</h1>
      <p className="mt-1.5 mb-7 text-[15px] leading-snug text-encre-2">
        Six caractères, que quelqu&apos;un de la bande t&apos;a donnés.
      </p>
      <FormulaireRejoindre />
    </main>
  );
}
