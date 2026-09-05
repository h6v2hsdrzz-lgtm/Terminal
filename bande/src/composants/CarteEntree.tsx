import { Avatar } from "./Avatar";
import { Carrousel } from "./Carrousel";
import { LecteurVocal } from "./LecteurVocal";
import { Carte } from "./Carte";
import { PiedEntree } from "./PiedEntree";
import { couleurJoie, couleurProfil } from "@/lib/couleurs";
import type { Annuaire, Entree } from "@/lib/types";

/**
 * Une journée dans le fil.
 *
 * Une mauvaise journée s'affiche exactement comme une bonne : même carte,
 * même place, même dignité. Seule la teinte du disque change, et elle ne
 * vire jamais au rouge.
 */
export function CarteEntree({
  entree,
  annuaire,
  moi,
  floute = false,
}: {
  entree: Entree;
  annuaire: Annuaire;
  /** Donné, la carte devient interactive : on peut réagir et commenter. */
  moi?: string;
  floute?: boolean;
}) {
  const profil = annuaire.profils.find((p) => p.id === entree.profil);
  // Une entrée peut survivre à son auteur — quelqu'un quitte la bande, ses
  // journées restent dans les statistiques. La carte ne doit pas s'effondrer
  // pour autant.
  if (!profil) return null;

  const couleur = couleurProfil(profil);

  /**
   * Sous le voile, on n'envoie rien.
   *
   * La première version rendait la carte entière et la floutait en CSS : le
   * texte partait donc dans le HTML, et un coup d'œil dans les outils du
   * navigateur suffisait à lire la journée des autres avant d'avoir posé la
   * sienne. Le voile n'est pas un dispositif de sécurité, mais il perd tout son
   * sens s'il se contourne en trois clics.
   *
   * On rend donc une carte muette : la personne, sa couleur, et des blocs
   * inertes qui disent qu'il y a quelque chose à lire.
   */
  if (floute) {
    return (
      <Carte accent={couleur} className="overflow-hidden">
        <div className="flex items-start gap-3 p-4" aria-hidden>
          <Avatar profil={profil} taille={38} />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <span className="block h-3 w-24 rounded-full bg-surface-2" />
            <span className="block h-3 w-full rounded-full bg-surface-2" />
            <span className="block h-3 w-2/3 rounded-full bg-surface-2" />
          </div>
          <span className="h-12 w-12 shrink-0 rounded-2xl bg-surface-2" />
        </div>
        <span className="sr-only">
          {profil.pseudo} a posé sa journée. Pose la tienne pour la lire.
        </span>
      </Carte>
    );
  }

  const declencheurs = entree.declencheurs
    .map((id) => annuaire.declencheurs.find((d) => d.id === id))
    .filter((d) => d !== undefined);

  return (
    <Carte accent={couleur} className="overflow-hidden">
      <div>
        <div className="flex items-start gap-3 p-4">
          <Avatar profil={profil} taille={38} />

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold tracking-tight">{profil.pseudo}</span>
              <span className="text-[12px] text-encre-3">{entree.posteA}</span>
            </div>

            {entree.titre && (
              <p className="mt-1 text-[19px] font-semibold leading-tight tracking-[-0.01em]">
                {entree.titre}
              </p>
            )}

            {entree.note && (
              <p className="mt-1.5 text-[15px] leading-snug text-encre-2">{entree.note}</p>
            )}

            {(declencheurs.length > 0 || entree.etiquettes.length > 0) && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {entree.etiquettes.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-[var(--radius-pilule)] bg-surface-3 px-2 py-0.5 text-[12px] text-encre-2"
                  >
                    {e.nom}
                  </li>
                ))}
                {declencheurs.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-[var(--radius-pilule)] border border-trait bg-surface-2 px-2 py-0.5 text-[12px] text-encre-2"
                  >
                    {d.emoji} {d.nom}
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

        {entree.photos.length > 0 && (
          <Carrousel photos={entree.photos} legende={`La journée de ${profil.pseudo}`} />
        )}

        {entree.audio && (
          <LecteurVocal audio={entree.audio} couleur={couleur} nom={profil.pseudo} />
        )}

        {/* Le pied n'apparaît qu'une fois le voile levé : réagir à une carte
            floutée reviendrait à commenter ce qu'on n'a pas lu. */}
        {moi && !floute ? (
          <PiedEntree
            entreeId={entree.id}
            reactions={entree.reactions}
            commentaires={entree.commentaires}
            annuaire={annuaire}
            moi={moi}
          />
        ) : (
          (entree.reactions.length > 0 || entree.commentaires.length > 0) && (
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
          )
        )}
      </div>
    </Carte>
  );
}
