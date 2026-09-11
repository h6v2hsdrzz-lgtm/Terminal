import Link from "next/link";

import { Carte, TitreSection } from "@/composants/Carte";
import { BoiteInvitation } from "@/composants/BoiteInvitation";
import { BoiteNotifications } from "@/composants/BoiteNotifications";
import { BoiteRestauration } from "@/composants/BoiteRestauration";
import { BoiteTheme } from "@/composants/BoiteTheme";
import { NouveautesAuChoix } from "@/composants/Nouveautes";
import { ReglagesBande } from "@/composants/ReglagesBande";
import { ZoneDepart } from "@/composants/ZoneDepart";
import { Avatar } from "@/composants/Avatar";
import { TAILLE_MAX_BANDE } from "@/lib/couleurs";
import { espaceOccupe } from "@/lib/depot";
import { enPoids } from "@/lib/media";
import { abonnementsDe, clePublique, lirePreferences } from "@/lib/pousse";
import { exigerContexte } from "@/lib/repaire";
import { NOUVEAUTES } from "@/lib/nouveautes";
import { PLAFOND_STOCKAGE } from "@/lib/stockage/plafond";

const RESUME_COURANT = NOUVEAUTES[0].resume;

export default async function Page() {
  const contexte = await exigerContexte();
  const espace = await espaceOccupe(contexte.groupe.id);
  const total = espace.medias.octets + espace.audios.octets;
  const part = Math.min(1, total / PLAFOND_STOCKAGE);
  const preferences = await lirePreferences(contexte.moi.id);
  const abonnements = await abonnementsDe(contexte.moi.id);

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
        <TitreSection>La place occupée</TitreSection>
        {/* Le détail a son propre écran depuis le lot M : répartition par
            personne et par type, les plus gros fichiers, les doublons. Ici on
            ne garde que ce qui se lit d'un coup d'œil, et le chemin pour y
            aller — cette page est déjà longue. */}
        <Link href="/reglages/stockage" className="block">
          <Carte className="p-4 transition hover:border-trait-fort">
            <div className="flex items-baseline justify-between gap-3">
              <span className="chiffres text-[15px] font-medium">{enPoids(total)}</span>
              <span className="text-[13px] text-encre-3">
                sur {enPoids(PLAFOND_STOCKAGE)} →
              </span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(1, Math.round(part * 100))}%`,
                  background: part > 0.85 ? "var(--profil-4)" : "var(--encre-2)",
                }}
              />
            </div>
            <p className="mt-2.5 text-[13px] leading-snug text-encre-3">
              {espace.medias.nombre} photo{espace.medias.nombre > 1 ? "s" : ""} et vidéo
              {espace.medias.nombre > 1 ? "s" : ""}, {espace.audios.nombre} note
              {espace.audios.nombre > 1 ? "s" : ""} vocale
              {espace.audios.nombre > 1 ? "s" : ""}.
            </p>
          </Carte>
        </Link>
      </section>

      <BoiteNotifications
        clePublique={clePublique()}
        preferences={preferences}
        abonnements={abonnements}
      />

      <BoiteTheme />

      <section className="mt-7">
        <TitreSection>Ce qui a changé</TitreSection>
        <Carte className="p-4">
          <p className="mb-3 text-[14px] leading-snug text-encre-2">
            {RESUME_COURANT}
          </p>
          <NouveautesAuChoix />
        </Carte>
      </section>

      <ReglagesBande
        nom={contexte.groupe.nom}
        revelerApresPost={contexte.groupe.revelerApresPost}
        declencheurs={contexte.declencheurs}
      />

      <ZoneDepart nomBande={contexte.groupe.nom} seul={contexte.profils.length === 1} />

      {/* Après « Emporter » : on ne restaure pas avant de savoir sauvegarder. */}
      <BoiteRestauration />
    </div>
  );
}
