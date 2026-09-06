import Link from "next/link";

import { BoiteAvatar } from "@/composants/BoiteAvatar";
import { Carte, TitreSection } from "@/composants/Carte";
import { Calendrier } from "@/composants/Calendrier";
import { ClassementAssiduite } from "@/composants/ClassementAssiduite";
import { MurBadges } from "@/composants/MurBadges";
import { NomDuProfil } from "@/composants/NomDuProfil";
import { AlbumPersonnel } from "@/composants/AlbumPersonnel";
import { badgesDe, classementAssiduite } from "@/lib/badges";
import { mediasDeLaBande } from "@/lib/depot";
import { enHeure, heureMoyenne, lieuFavori, motFavori, partVocale } from "@/lib/portrait";
import { Niveau } from "@/composants/Niveau";
import { ardoise } from "@/lib/points";
import { listerCapsules } from "@/lib/depot";
import { gainsDeLaBande } from "@/lib/depot-jeux";
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
  const capsules = await listerCapsules(contexte.groupe.id, contexte.moi.id, aujourdhui);
  const gains = await gainsDeLaBande(contexte.groupe.id);
  const mesPoints = ardoise(
    entrees,
    contexte.moi.id,
    capsules.map((c) => ({ auteurId: c.auteurId, creeLe: c.creeLe })),
    gains,
  );
  // Le premier scellé ouvert, pour le badge : les capsules arrivent triées par
  // date d'ouverture, la première ouverte est donc la plus ancienne.
  const scelleOuvertLe =
    capsules.find((c) => c.ouvrirLe <= aujourdhui && c.auteurId === contexte.moi.id)?.ouvrirLe ?? null;

  // Le premier podium : la plus ancienne partie finie où l'on est dans les
  // trois premiers. Les gains sont rendus des plus récents aux plus anciens,
  // d'où le tri plutôt qu'un simple `find`.
  const podiumLe =
    gains
      .filter((g) => g.membreId === contexte.moi.id && g.place <= 3)
      .map((g) => g.jour)
      .sort()[0] ?? null;

  const badges = badgesDe(miennes, entrees, contexte.moi.id, {
    points: mesPoints.total,
    scelleOuvertLe,
    podiumLe,
  });

  // Dix vignettes, demandées comme telles : filtrer côté base plutôt que de
  // ramener toute la bande pour en garder un quart.
  const album = await mediasDeLaBande(contexte.groupe.id, 10, contexte.moi.id);

  // Quatre traits, et chacun se tait quand il n'y a pas de quoi le dire.
  const heure = heureMoyenne(miennes);
  const lieu = lieuFavori(miennes);
  const vocale = partVocale(miennes);
  const mot = motFavori(miennes);
  const traits = [
    heure !== null && { quoi: "Tu poses ta journée vers", valeur: enHeure(heure) },
    lieu && { quoi: "Le plus souvent", valeur: lieu.nom },
    // En dessous d'un vingtième, ce n'est pas un trait de caractère, c'est
    // une poignée de fois — et « tu préfères parler 1 % du temps » dit le
    // contraire de ce que le chiffre montre.
    vocale !== null && vocale >= 0.05 && {
      quoi: "Tu laisses un vocal", valeur: `${Math.round(vocale * 100)} % du temps`,
    },
    mot && { quoi: "Le mot qui revient", valeur: `« ${mot.mot} »` },
  ].filter((t): t is { quoi: string; valeur: string } => Boolean(t));
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

      <section className="mt-7">
        <TitreSection>Tes points</TitreSection>
        <Niveau ardoise={mesPoints} />
      </section>

      <ClassementAssiduite
        classement={classementAssiduite(entrees, contexte.profils.map((p) => p.id), aujourdhui)}
        profils={contexte.profils}
        entrees={entrees}
        aujourdhui={aujourdhui}
        moi={contexte.moi.id}
      />

      {(album.length > 0 || traits.length > 0) && (
        <section className="mt-7">
          <TitreSection>Toi, en petit</TitreSection>
          <Carte className="p-4">
            <AlbumPersonnel medias={album} />
            {traits.length > 0 && (
              <ul className={album.length > 0 ? "mt-3 space-y-1.5" : "space-y-1.5"}>
                {traits.map((trait) => (
                  <li key={trait.quoi} className="text-[13px] leading-snug text-encre-2">
                    {trait.quoi} <span className="font-medium text-encre">{trait.valeur}</span>.
                  </li>
                ))}
              </ul>
            )}
          </Carte>
        </section>
      )}

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
