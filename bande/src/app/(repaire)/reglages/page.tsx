import Link from "next/link";

import { Carte, TitreSection } from "@/composants/Carte";
import { BoiteInvitation } from "@/composants/BoiteInvitation";
import { ReglagesBande } from "@/composants/ReglagesBande";
import { ZoneDepart } from "@/composants/ZoneDepart";
import { Avatar } from "@/composants/Avatar";
import { TAILLE_MAX_BANDE } from "@/lib/couleurs";
import { espaceOccupe } from "@/lib/depot";
import { enPoids } from "@/lib/media";
import { exigerContexte } from "@/lib/repaire";

/**
 * Un demi-giga-octet : l'offre gratuite de Neon, où vivent photos, vidéos et
 * notes vocales avec les journées.
 */
const PLAFOND = 512 * 1024 * 1024;

export default async function Page() {
  const contexte = await exigerContexte();
  const espace = await espaceOccupe(contexte.groupe.id);
  const total = espace.medias.octets + espace.audios.octets;
  const part = Math.min(1, total / PLAFOND);

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

      <section className="mt-7">
        <TitreSection action={<span className="chiffres text-[13px] text-encre-3">{enPoids(total)}</span>}>
          La place occupée
        </TitreSection>
        <Carte className="p-4">
          {/* Cette application ne coûte rien, et ce n'est pas gratuit par
              magie : tout tient dans une base d'un demi-giga-octet. Le dire ici
              vaut mieux qu'un refus d'envoi le jour où elle est pleine. */}
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(1, Math.round(part * 100))}%`,
                background: part > 0.85 ? "var(--profil-4)" : "var(--encre-2)",
              }}
            />
          </div>
          <p className="mt-2.5 text-[13px] leading-snug text-encre-2">
            {espace.medias.nombre} {espace.medias.nombre > 1 ? "photos et vidéos" : "photo ou vidéo"} et{" "}
            {espace.audios.nombre} {espace.audios.nombre > 1 ? "notes vocales" : "note vocale"}, soit{" "}
            {enPoids(total)} sur {enPoids(PLAFOND)}.
          </p>
          <p className="mt-1.5 text-[13px] leading-snug text-encre-3">
            {part > 0.85
              ? "C'est presque plein. Retirer quelques vidéos anciennes libère beaucoup d'un coup."
              : "Les vidéos sont réduites sur ton téléphone avant d'être envoyées : c'est ce qui permet d'en poster sans rien payer."}
          </p>
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
