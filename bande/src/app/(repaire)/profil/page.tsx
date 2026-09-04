import { Avatar } from "@/composants/Avatar";
import { Carte, TitreSection } from "@/composants/Carte";
import { Calendrier } from "@/composants/Calendrier";
import { BoiteInvitation } from "@/composants/BoiteInvitation";
import { badgesDe, serieEnCours } from "@/lib/badges";
import { TAILLE_MAX_BANDE, couleurProfil } from "@/lib/couleurs";
import { entreesDeLaBande, exigerContexte } from "@/lib/repaire";
import { actionQuitter } from "@/lib/actions";
import { enTexteLong, jourDeLaBande } from "@/lib/dates";

export default async function Page() {
  const contexte = await exigerContexte();
  const aujourdhui = jourDeLaBande();
  const entrees = await entreesDeLaBande(contexte.groupe.id);
  const miennes = entrees.filter((e) => e.profil === contexte.moi.id);

  const moyenne = miennes.length
    ? miennes.reduce((s, e) => s + e.joie, 0) / miennes.length
    : null;
  const serie = serieEnCours(new Set(miennes.map((e) => e.jour)), aujourdhui);

  const badges = badgesDe(miennes);
  const obtenus = badges.filter((b) => b.obtenuLe);
  const aVenir = badges.filter((b) => !b.obtenuLe);

  return (
    <div className="px-4 pt-3">
      <header className="mb-6 flex items-center gap-4 zone-sure-haute">
        <Avatar profil={contexte.moi} taille={64} anneau />
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold tracking-[-0.02em]">{contexte.moi.pseudo}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-encre-3">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: couleurProfil(contexte.moi) }}
            />
            ta couleur dans {contexte.groupe.nom}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {[
          { valeur: serie.toString(), libelle: serie > 1 ? "jours d'affilée" : "jour d'affilée" },
          { valeur: moyenne === null ? "—" : moyenne.toFixed(1).replace(".", ","), libelle: "de moyenne" },
          { valeur: miennes.length.toString(), libelle: "journées posées" },
        ].map((tuile) => (
          <Carte key={tuile.libelle} className="px-3 py-4 text-center">
            <p className="chiffres text-[26px]">{tuile.valeur}</p>
            <p className="mt-1 text-[12px] leading-tight text-encre-3">{tuile.libelle}</p>
          </Carte>
        ))}
      </div>

      <section className="mt-7">
        <TitreSection>Inviter</TitreSection>
        <BoiteInvitation
          code={contexte.groupe.codeInvitation}
          places={TAILLE_MAX_BANDE - contexte.profils.length}
        />
      </section>

      <section className="mt-7">
        <TitreSection>Tes dix dernières semaines</TitreSection>
        <Carte className="p-4">
          <div className="flex justify-center">
            <Calendrier entrees={miennes} jusquA={aujourdhui} />
          </div>
          <p className="mt-3 text-[12px] text-encre-3">
            Une case par jour. Les cases vides sont les jours sans check-in — elles ne
            reprochent rien, elles racontent juste.
          </p>
        </Carte>
      </section>

      <section className="mt-7">
        <TitreSection action={<span className="text-[13px] text-encre-3">{obtenus.length} / {badges.length}</span>}>
          Badges
        </TitreSection>
        <Carte className="p-4">
          <ul className="grid grid-cols-2 gap-3">
            {obtenus.map((badge) => (
              <li key={badge.cle} className="flex items-start gap-2.5 rounded-2xl bg-surface-2 p-3">
                <span className="text-[22px] leading-none">{badge.emoji}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold tracking-tight">{badge.nom}</span>
                  <span className="block text-[12px] leading-snug text-encre-3">
                    {enTexteLong(badge.obtenuLe!)}
                  </span>
                </span>
              </li>
            ))}
            {aVenir.map((badge) => (
              <li key={badge.cle} className="flex items-start gap-2.5 rounded-2xl border border-dashed border-trait-fort p-3 opacity-60">
                <span className="text-[22px] leading-none grayscale">{badge.emoji}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold tracking-tight">{badge.nom}</span>
                  <span className="block text-[12px] leading-snug text-encre-3">{badge.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </Carte>
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
