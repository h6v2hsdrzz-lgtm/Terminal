import Link from "next/link";

import { FormulaireReprendre } from "@/composants/FormulairesEntree";

export default function Page() {
  return (
    <main>
      <Link href="/bienvenue" className="mb-6 inline-block text-[14px] text-encre-3 hover:text-encre-2">
        ← Retour
      </Link>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Retrouver son compte</h1>
      <p className="mt-1.5 mb-7 text-[15px] leading-snug text-encre-2">
        Le code de reprise qu&apos;on t&apos;a montré à l&apos;inscription. C&apos;est le seul moyen :
        sans email ni mot de passe, il n&apos;y a rien d&apos;autre à quoi te rattacher.
      </p>
      <FormulaireReprendre />
    </main>
  );
}
