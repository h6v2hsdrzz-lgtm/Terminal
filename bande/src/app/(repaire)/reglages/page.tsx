import Link from "next/link";

import { Carte, TitreSection } from "@/composants/Carte";
import { BoiteInvitation } from "@/composants/BoiteInvitation";
import { ReglagesBande } from "@/composants/ReglagesBande";
import { ZoneDepart } from "@/composants/ZoneDepart";
import { Avatar } from "@/composants/Avatar";
import { TAILLE_MAX_BANDE } from "@/lib/couleurs";
import { exigerContexte } from "@/lib/repaire";

export default async function Page() {
  const contexte = await exigerContexte();

  return (
    <div className="px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <Link href="/profil" className="mb-3 inline-block text-[14px] text-encre-3 hover:text-encre-2">
          ← Profil
        </Link>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Réglages de la bande</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">
          Tout le monde peut les changer. C&apos;est une bande, pas une hiérarchie.
        </p>
      </header>

      <section>
        <TitreSection>Inviter</TitreSection>
        <BoiteInvitation
          code={contexte.groupe.codeInvitation}
          places={TAILLE_MAX_BANDE - contexte.profils.length}
        />
      </section>

      <section className="mt-7">
        <TitreSection action={<span className="text-[13px] text-encre-3">{contexte.profils.length} / {TAILLE_MAX_BANDE}</span>}>
          Qui est là
        </TitreSection>
        <Carte className="p-4">
          <ul className="space-y-3">
            {contexte.profils.map((profil) => (
              <li key={profil.id} className="flex items-center gap-3">
                <Avatar profil={profil} taille={34} />
                <span className="text-[15px]">{profil.pseudo}</span>
                {profil.id === contexte.moi.id && (
                  <span className="ml-auto text-[12px] text-encre-3">c&apos;est toi</span>
                )}
              </li>
            ))}
          </ul>
        </Carte>
      </section>

      <ReglagesBande
        nom={contexte.groupe.nom}
        revelerApresPost={contexte.groupe.revelerApresPost}
        declencheurs={contexte.declencheurs}
      />

      <ZoneDepart nomBande={contexte.groupe.nom} seul={contexte.profils.length === 1} />
    </div>
  );
}
