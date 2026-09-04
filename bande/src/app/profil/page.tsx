import { Avatar } from "@/composants/Avatar";
import { Carte, TitreSection } from "@/composants/Carte";
import { Calendrier } from "@/composants/Calendrier";
import { couleurProfil } from "@/lib/couleurs";
import { BADGES, ENTREES, MOI, PROFILS } from "@/lib/factices";
import { decaler, jourDeLaBande } from "@/lib/dates";

export default function Page() {
  const moi = PROFILS.find((p) => p.id === MOI)!;
  const miennes = ENTREES.filter((e) => e.profil === MOI);
  const aujourdhui = jourDeLaBande();

  const moyenne = miennes.reduce((s, e) => s + e.joie, 0) / miennes.length;
  const jours = new Set(miennes.map((e) => e.jour));

  let curseur = jours.has(aujourdhui) ? aujourdhui : decaler(aujourdhui, -1);
  let serie = 0;
  while (jours.has(curseur)) {
    serie += 1;
    curseur = decaler(curseur, -1);
  }

  const obtenus = BADGES.filter((b) => b.obtenuLe);
  const aVenir = BADGES.filter((b) => !b.obtenuLe);

  return (
    <div className="px-4 pt-3">
      <header className="mb-6 flex items-center gap-4 zone-sure-haute">
        <Avatar profil={moi} taille={64} anneau />
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{moi.pseudo}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-encre-3">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: couleurProfil(moi) }}
            />
            ta couleur dans la bande
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {[
          { valeur: serie.toString(), libelle: serie > 1 ? "jours d'affilée" : "jour d'affilée" },
          { valeur: moyenne.toFixed(1).replace(".", ","), libelle: "de moyenne" },
          { valeur: miennes.length.toString(), libelle: "journées posées" },
        ].map((tuile) => (
          <Carte key={tuile.libelle} className="px-3 py-4 text-center">
            <p className="chiffres text-[26px]">{tuile.valeur}</p>
            <p className="mt-1 text-[12px] leading-tight text-encre-3">{tuile.libelle}</p>
          </Carte>
        ))}
      </div>

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
        <TitreSection action={<span className="text-[13px] text-encre-3">{obtenus.length} / {BADGES.length}</span>}>
          Badges
        </TitreSection>
        <Carte className="p-4">
          <ul className="grid grid-cols-2 gap-3">
            {obtenus.map((badge) => (
              <li key={badge.cle} className="flex items-start gap-2.5 rounded-2xl bg-surface-2 p-3">
                <span className="text-[22px] leading-none">{badge.emoji}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold tracking-tight">{badge.nom}</span>
                  <span className="block text-[12px] leading-snug text-encre-3">{badge.description}</span>
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
    </div>
  );
}
