import { redirect } from "next/navigation";

import { BoutonPrincipal } from "@/composants/Champ";
import { actionCodeNote } from "@/lib/actions";
import { lireCodeReprise } from "@/lib/session";

/**
 * Le code de reprise, montré une fois.
 *
 * C'est le seul écran de l'application qui affiche un secret, et le seul
 * moment où il est lisible : après, il n'existe plus que sous forme
 * d'empreinte. La page le dit sans dramatiser — mais elle le dit.
 */
export default async function Page() {
  const code = await lireCodeReprise();
  // Rechargée plus tard, la page n'a plus rien à montrer.
  if (!code) redirect("/");

  return (
    <main>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Note ce code</h1>
      <p className="mt-1.5 text-[15px] leading-snug text-encre-2">
        Il sert à retrouver ton compte si tu changes de téléphone ou que tu vides
        ton navigateur. On ne peut pas te le renvoyer : de notre côté, il n&apos;en
        reste qu&apos;une empreinte.
      </p>

      <p className="chiffres my-8 rounded-[var(--radius-carte)] border border-trait-fort bg-surface px-4 py-6 text-center text-[26px] tracking-[0.14em] shadow-[var(--ombre-1)]">
        {code}
      </p>

      <form action={actionCodeNote}>
        <BoutonPrincipal type="submit">C&apos;est noté, on y va</BoutonPrincipal>
      </form>

      <p className="mt-4 text-center text-[13px] leading-snug text-encre-3">
        Une capture d&apos;écran fait très bien l&apos;affaire.
      </p>
    </main>
  );
}
