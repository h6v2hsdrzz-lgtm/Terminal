import Link from "next/link";

import { Avatar } from "@/composants/Avatar";
import { Carte, TitreSection } from "@/composants/Carte";
import { BoutonCopies } from "@/composants/stockage/BoutonCopies";
import { JaugeStockage } from "@/composants/stockage/JaugeStockage";
import { analyserStockage, espaceOccupe } from "@/lib/depot";
import { enTexteLong } from "@/lib/dates";
import { enPoids } from "@/lib/media";
import { exigerContexte } from "@/lib/repaire";
import { PLAFOND_STOCKAGE, nomDuDepot } from "@/lib/stockage/plafond";

/**
 * Réglages → Stockage.
 *
 * L'écran existe parce que cette application ne coûte rien, et que « ne rien
 * coûter » a une limite chiffrée. Mieux vaut la voir monter que découvrir un
 * refus d'envoi un soir de vacances.
 *
 * Il dit trois choses, dans cet ordre : combien il reste, qui occupe quoi, et
 * ce qu'on peut récupérer tout de suite.
 */
export default async function Page() {
  const contexte = await exigerContexte();
  const [espace, analyse] = await Promise.all([
    espaceOccupe(contexte.groupe.id),
    analyserStockage(contexte.groupe.id, contexte.moi.id),
  ]);
  const total = espace.medias.octets + espace.audios.octets;
  const nom = (id: string) =>
    contexte.profils.find((p) => p.id === id)?.pseudo ?? "quelqu'un";

  const recuperable = analyse.doublons.reduce((s, d) => s + d.recuperable, 0);

  return (
    <div className="px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <Link
          href="/reglages"
          className="mb-3 inline-block text-[14px] text-encre-3 hover:text-encre-2"
        >
          ← Réglages
        </Link>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Stockage</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">
          {espace.medias.nombre} photo{espace.medias.nombre > 1 ? "s" : ""} et vidéo
          {espace.medias.nombre > 1 ? "s" : ""}, {espace.audios.nombre} note
          {espace.audios.nombre > 1 ? "s" : ""} vocale{espace.audios.nombre > 1 ? "s" : ""}.
        </p>
      </header>

      <JaugeStockage total={total} plafond={PLAFOND_STOCKAGE} depot={nomDuDepot()} />

      <section className="mt-7">
        <TitreSection>Par personne</TitreSection>
        <Carte className="p-4">
          <ul className="space-y-3">
            {analyse.parPersonne.map((ligne) => {
              const profil = contexte.profils.find((p) => p.id === ligne.profil);
              const part = total > 0 ? ligne.octets / total : 0;
              return (
                <li key={ligne.profil} className="flex items-center gap-3">
                  {profil && <Avatar profil={profil} taille={30} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[14px] font-medium">{nom(ligne.profil)}</span>
                      <span className="chiffres text-[13px] text-encre-3">
                        {enPoids(ligne.octets)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-encre-2"
                        style={{ width: `${Math.max(2, Math.round(part * 100))}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Carte>
      </section>

      <section className="mt-7">
        <TitreSection>Par type</TitreSection>
        <Carte className="p-4">
          <ul className="space-y-2.5 text-[14px]">
            {(
              [
                ["Vidéos", analyse.parType.videos],
                ["Photos", analyse.parType.photos],
                ["Notes vocales", analyse.parType.audios],
              ] as const
            ).map(([libelle, octets]) => (
              <li key={libelle} className="flex items-baseline justify-between gap-3">
                <span>{libelle}</span>
                <span className="chiffres text-[13px] text-encre-3">{enPoids(octets)}</span>
              </li>
            ))}
          </ul>
          {/* La vidéo pèse dix fois la photo : le dire ici évite de chercher
              longtemps d'où vient la place. */}
          <p className="mt-3 text-[13px] leading-snug text-encre-3">
            Une vidéo de huit secondes pèse à peu près autant que vingt photos.
            C&apos;est presque toujours là qu&apos;est la place.
          </p>
        </Carte>
      </section>

      {analyse.doublons.length > 0 && (
        <section className="mt-7">
          <TitreSection
            action={
              <span className="chiffres text-[13px] text-encre-3">
                {enPoids(recuperable)} à reprendre
              </span>
            }
          >
            Les mêmes, plusieurs fois
          </TitreSection>
          <Carte className="divide-y divide-trait">
            {analyse.doublons.map((doublon) => (
              <div key={doublon.empreinte} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px]">
                    {doublon.exemplaires} fois le même fichier
                  </p>
                  <p className="mt-0.5 text-[13px] text-encre-3">
                    {enPoids(doublon.octets)} pièce — {enPoids(doublon.recuperable)} à
                    récupérer en gardant le premier
                  </p>
                </div>
                {doublon.miennes > 0 ? (
                  <BoutonCopies empreinte={doublon.empreinte} />
                ) : (
                  // Le bouton n'apparaît pas quand il n'y a rien à retirer :
                  // un bouton qui répond « pas les tiennes » après deux taps
                  // est un bouton qui ment sur ce qu'il fait.
                  <span className="shrink-0 text-[12px] text-encre-3">
                    pas les tiennes
                  </span>
                )}
              </div>
            ))}
          </Carte>
          <p className="mt-2 px-1 text-[12px] leading-snug text-encre-3">
            Le premier envoyé reste toujours : c&apos;est lui qui porte les réactions
            et les commentaires. Et chacun ne retire que les siens.
          </p>
        </section>
      )}

      <section className="mt-7 mb-4">
        <TitreSection>Les plus gros</TitreSection>
        <Carte className="divide-y divide-trait">
          {analyse.plusGros.map((media) => (
            <Link
              key={media.id}
              href="/galerie"
              className="flex items-center gap-3 p-3.5 transition active:bg-surface-2"
            >
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-[15px]"
              >
                {media.genre === "video" ? "🎬" : "🖼️"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px]">
                  {media.legende ?? enTexteLong(media.jour)}
                </p>
                <p className="mt-0.5 text-[13px] text-encre-3">{nom(media.profil)}</p>
              </div>
              <span className="chiffres shrink-0 text-[13px] text-encre-3">
                {enPoids(media.octets)}
              </span>
            </Link>
          ))}
        </Carte>
      </section>
    </div>
  );
}
