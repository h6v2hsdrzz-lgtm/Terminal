import { BoutonReessayer } from "@/composants/BoutonReessayer";
import { VisageJoie } from "@/composants/VisageJoie";

/**
 * L'écran servi quand le réseau manque.
 *
 * Il n'est pas dans le groupe du repaire : il doit s'afficher sans session, et
 * sans base — c'est justement le moment où rien n'est joignable. Le ton reste
 * celui du reste de l'application : ce n'est pas une panne, c'est un tunnel.
 */
export const metadata = { title: "Hors ligne — Journal de joie" };

export default function Page() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <VisageJoie valeur={5} taille={84} />
      <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.02em]">Pas de réseau</h1>
      <p className="mt-2 max-w-[20rem] text-[15px] leading-snug text-encre-2">
        Ta journée du soir t&apos;attend dès que ça revient. Si tu l&apos;as écrite hors
        ligne, elle est gardée sur ce téléphone et partira toute seule.
      </p>
      <BoutonReessayer />
    </div>
  );
}
