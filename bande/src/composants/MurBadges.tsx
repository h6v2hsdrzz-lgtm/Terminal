import { Carte, TitreSection } from "./Carte";
import { enTexteLong } from "@/lib/dates";
import type { Badge } from "@/lib/types";

/**
 * Les badges obtenus, et ceux qui restent.
 *
 * Les deux n'ont pas droit à la même place. Un badge obtenu porte une date —
 * c'est un souvenir daté, pas une case cochée. Un badge à venir n'a besoin que
 * de son nom et de sa condition : lui donner autant de surface remplirait
 * l'écran d'absences, et le mur finirait par parler surtout de ce qu'on n'a
 * pas fait.
 */
export function MurBadges({ badges }: { badges: Badge[] }) {
  const obtenus = badges.filter((b) => b.obtenuLe);
  const aVenir = badges.filter((b) => !b.obtenuLe);

  return (
    <section className="mt-7">
      <TitreSection
        action={
          <span className="chiffres text-[13px] text-encre-3">
            {obtenus.length} / {badges.length}
          </span>
        }
      >
        Badges
      </TitreSection>

      <Carte className="p-4">
        {obtenus.length === 0 ? (
          <p className="text-[14px] leading-snug text-encre-2">
            Aucun pour l&apos;instant. Le premier tombe dès la première journée posée.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {obtenus.map((badge) => (
              <li key={badge.cle} className="flex items-start gap-2.5 rounded-2xl bg-surface-2 p-3">
                <span className="text-[22px] leading-none">{badge.emoji}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold leading-tight tracking-tight">
                    {badge.nom}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-encre-3">
                    {enTexteLong(badge.obtenuLe!)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {aVenir.length > 0 && (
          <>
            <p className="mt-4 mb-2 border-t border-trait pt-3 text-[13px] text-encre-3">
              {aVenir.length} à venir
            </p>
            {/* Plus compact, trois par ligne : la condition suffit, et le mur
                reste celui de ce qu'on a fait. */}
            <ul className="grid grid-cols-3 gap-2">
              {aVenir.map((badge) => (
                <li
                  key={badge.cle}
                  className="rounded-xl border border-dashed border-trait-fort p-2 text-center opacity-70"
                >
                  <span className="block text-[18px] leading-none grayscale">{badge.emoji}</span>
                  <span className="mt-1 block text-[11px] font-medium leading-tight tracking-tight">
                    {badge.nom}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-tight text-encre-3">
                    {badge.description}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Carte>
    </section>
  );
}
