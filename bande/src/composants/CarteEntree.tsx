import { Avatar } from "./Avatar";
import { Carte } from "./Carte";
import { couleurJoie, couleurProfil } from "@/lib/couleurs";
import { DECLENCHEURS, PROFILS } from "@/lib/factices";
import type { Entree } from "@/lib/types";

/**
 * Une journée dans le fil.
 *
 * Une mauvaise journée s'affiche exactement comme une bonne : même carte,
 * même place, même dignité. Seule la teinte du disque change, et elle ne
 * vire jamais au rouge.
 */
export function CarteEntree({ entree, floute = false }: { entree: Entree; floute?: boolean }) {
  const profil = PROFILS.find((p) => p.id === entree.profil)!;
  const couleur = couleurProfil(profil);
  const declencheurs = entree.declencheurs
    .map((id) => DECLENCHEURS.find((d) => d.id === id))
    .filter(Boolean);

  return (
    <Carte accent={couleur} className="overflow-hidden">
      <div className={floute ? "pointer-events-none select-none blur-[10px]" : ""} aria-hidden={floute}>
        <div className="flex items-start gap-3 p-4">
          <Avatar profil={profil} taille={38} />

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold tracking-tight">{profil.pseudo}</span>
              <span className="text-[12px] text-encre-3">{entree.posteA}</span>
            </div>

            {entree.note && (
              <p className="mt-1.5 text-[15px] leading-snug text-encre-2">{entree.note}</p>
            )}

            {declencheurs.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {declencheurs.map((d) => (
                  <li
                    key={d!.id}
                    className="rounded-[var(--radius-pilule)] border border-trait bg-surface-2 px-2 py-0.5 text-[12px] text-encre-2"
                  >
                    {d!.emoji} {d!.nom}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl"
            style={{ background: couleurJoie(entree.joie) }}
          >
            <span className="chiffres text-[19px] text-encre">{entree.joie}</span>
          </div>
        </div>

        {(entree.reactions.length > 0 || entree.commentaires.length > 0) && (
          <div className="flex items-center gap-2 border-t border-trait px-4 py-2.5">
            {entree.reactions.map((r) => (
              <span
                key={r.emoji}
                className="inline-flex items-center gap-1 rounded-[var(--radius-pilule)] border border-trait bg-surface-2 px-2 py-1 text-[13px]"
              >
                {r.emoji}
                <span className="chiffres text-[12px] text-encre-2">{r.parQui.length}</span>
              </span>
            ))}
            {entree.commentaires.length > 0 && (
              <span className="ml-auto text-[12px] text-encre-3">
                {entree.commentaires.length} commentaire{entree.commentaires.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </Carte>
  );
}
