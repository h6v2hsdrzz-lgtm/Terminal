import Link from "next/link";

import { BoiteAvatar } from "@/composants/BoiteAvatar";
import { Carte, TitreSection } from "@/composants/Carte";
import { Calendrier } from "@/composants/Calendrier";
import { ClassementAssiduite } from "@/composants/ClassementAssiduite";
import { MurBadges } from "@/composants/MurBadges";
import { NomDuProfil } from "@/composants/NomDuProfil";
import { badgesDe, classementAssiduite } from "@/lib/badges";
import { couleurProfil } from "@/lib/couleurs";
import { entreesDeLaBande, exigerContexte } from "@/lib/repaire";
import { actionQuitter } from "@/lib/actions";
import { jourDeLaBande } from "@/lib/dates";

export default async function Page() {
  const contexte = await exigerContexte();
  const aujourdhui = jourDeLaBande();
  const entrees = await entreesDeLaBande(contexte.groupe.id);
  const miennes = entrees.filter((e) => e.profil === contexte.moi.id);

  const moyenne = miennes.length
    ? miennes.reduce((s, e) => s + e.joie, 0) / miennes.length
    : null;
  const badges = badgesDe(miennes, entrees, contexte.moi.id);
  return (
    <div className="px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <BoiteAvatar profil={contexte.moi} />
        <div className="mt-3 min-w-0">
          <NomDuProfil pseudo={contexte.moi.pseudo} />
          <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-encre-3">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: couleurProfil(contexte.moi) }}
            />
            ta couleur dans {contexte.groupe.nom}
          </p>
        </div>
      </header>

      <ClassementAssiduite
        classement={classementAssiduite(entrees, contexte.profils.map((p) => p.id), aujourdhui)}
        profils={contexte.profils}
        entrees={entrees}
        aujourdhui={aujourdhui}
        moi={contexte.moi.id}
      />

      <section className="mt-7">
        <TitreSection>Tes dix dernières semaines</TitreSection>
        <Carte className="p-4">
          <div className="flex justify-center">
            <Calendrier entrees={miennes} jusquA={aujourdhui} />
          </div>
          <p className="mt-3 text-[12px] leading-snug text-encre-3">
            Une case par jour. Les cases vides sont les jours sans check-in — elles ne
            reprochent rien, elles racontent juste.
            {moyenne !== null && (
              <>
                {" "}Ta moyenne sur l&apos;ensemble :{" "}
                <span className="chiffres">{moyenne.toFixed(1).replace(".", ",")}</span>.
              </>
            )}
          </p>
        </Carte>
      </section>

      <MurBadges badges={badges} />

      <section className="mt-7">
        <Link
          href="/reglages"
          className="flex items-center justify-between rounded-[var(--radius-carte)] border border-trait bg-surface px-4 py-3.5 shadow-[var(--ombre-1)] transition hover:border-trait-fort"
        >
          <span className="text-[15px] font-medium">Réglages de la bande</span>
          <span className="text-[13px] text-encre-3">
            inviter · nom · déclencheurs →
          </span>
        </Link>
      </section>

      <section className="mt-7">
        <form action={actionQuitter}>
          <button
            type="submit"
            className="w-full rounded-[var(--radius-pilule)] border border-trait-fort bg-surface py-3 text-[14px] font-medium text-encre-2 transition hover:border-encre-3"
          >
            Se déconnecter de cet appareil
          </button>
        </form>
        <p className="mt-2 text-center text-[12px] leading-snug text-encre-3">
          Tes journées restent dans la bande. Il faudra ton code de reprise pour revenir.
        </p>
      </section>
    </div>
  );
}
