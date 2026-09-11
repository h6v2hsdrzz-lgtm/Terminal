import { Carte } from "../Carte";
import { enPoids } from "@/lib/media";

/**
 * La jauge, et la phrase qui va avec.
 *
 * Une barre seule ne dit rien : à 40 %, faut-il s'inquiéter ? La phrase tranche
 * à sa place, et change de ton aux deux seuils qui comptent — celui où l'on
 * peut encore trier tranquillement, et celui où l'envoi va commencer à refuser.
 */
export function JaugeStockage({
  total,
  plafond,
  depot,
}: {
  total: number;
  plafond: number;
  depot: string;
}) {
  const part = Math.min(1, total / plafond);
  const serre = part > 0.85;
  const tiede = part > 0.6;

  return (
    <Carte className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="chiffres text-[22px] font-semibold">{enPoids(total)}</span>
        <span className="text-[13px] text-encre-3">sur {enPoids(plafond)}</span>
      </div>

      <div
        role="meter"
        aria-valuenow={Math.round(part * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Place occupée"
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(1, Math.round(part * 100))}%`,
            background: serre ? "var(--profil-4)" : tiede ? "var(--profil-3)" : "var(--encre-2)",
          }}
        />
      </div>

      <p className="mt-2.5 text-[13px] leading-snug text-encre-2">
        {serre
          ? "C'est presque plein. Retirer deux ou trois vidéos anciennes libère beaucoup d'un coup."
          : tiede
            ? "Il reste de la marge, mais ça monte. Les doublons plus bas sont le plus facile à reprendre."
            : "Large. Les photos sont réduites sur ton téléphone avant d'être envoyées — c'est ce qui permet d'en poster sans rien payer."}
      </p>
      <p className="mt-1 text-[12px] text-encre-3">Les fichiers vivent dans {depot}.</p>
    </Carte>
  );
}
