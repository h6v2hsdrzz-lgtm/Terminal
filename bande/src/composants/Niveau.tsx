import { Carte } from "./Carte";
import { NIVEAUX, type Ardoise, niveau } from "@/lib/points";

/**
 * Les points et le niveau, en petit.
 *
 * Pas de classement : à trois, un classement de points est un classement de
 * présence, même déguisé. Le niveau monte seul et ne se compare à personne.
 *
 * Le détail est là pour que le nombre s'explique. Un score sans provenance,
 * c'est un chiffre à croire sur parole — et on finit par jouer contre lui.
 */
export function Niveau({ ardoise }: { ardoise: Ardoise }) {
  const n = niveau(ardoise.total);

  return (
    <Carte className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-semibold">{n.nom}</p>
        <p className="chiffres text-[15px] text-encre-2">{ardoise.total} pts</p>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full transition-[width] duration-[var(--duree-longue)]"
          style={{ width: `${Math.max(2, Math.round(n.part * 100))}%`, background: "var(--encre-2)" }}
        />
      </div>

      <p className="mt-1.5 text-[12px] text-encre-3">
        {n.restant === null
          ? `Dernier palier sur ${NIVEAUX.length}. Il n'y a plus rien à gravir.`
          : `Encore ${n.restant} points avant « ${NIVEAUX[n.rang].nom} ».`}
      </p>

      {ardoise.detail.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-trait pt-3">
          {ardoise.detail.map((d) => (
            <li key={d.quoi} className="text-[12px] text-encre-3">
              {d.quoi} <span className="chiffres text-encre-2">{d.points}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[12px] leading-snug text-encre-3">
        Les points comptent la présence, l&apos;attention aux autres et les
        parties — jamais la note. Une journée à 1 en rapporte autant qu&apos;une
        journée à 10.
      </p>
    </Carte>
  );
}

/** Le niveau à côté d'un nom, dans le fil. Discret, ou rien. */
export function Pastille({ points }: { points: number }) {
  const n = niveau(points);
  if (n.rang === 1) return null;
  return (
    <span
      className="rounded-[var(--radius-pilule)] bg-surface-3 px-1.5 py-0.5 text-[11px] text-encre-3"
      title={n.nom}
    >
      {n.nom}
    </span>
  );
}
