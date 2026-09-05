import Link from "next/link";

import { Carte } from "@/composants/Carte";
import { Galerie } from "@/composants/Galerie";
import { compterMedias, mediasDeLaBande } from "@/lib/depot";
import { exigerContexte } from "@/lib/repaire";

/**
 * La galerie : tout ce que la bande a posté, sans les journées autour.
 *
 * Elle n'a pas d'onglet à elle. Cinq onglets remplissent déjà la largeur d'un
 * iPhone, et un sixième rendrait les libellés illisibles — on y entre depuis
 * les souvenirs, qui est l'écran où l'on vient pour regarder en arrière.
 */
/**
 * Combien on en affiche d'un coup.
 *
 * Les vignettes se chargent au fil du défilement, mais le document, lui, est
 * rendu en entier : quelques milliers de cases feraient une page que le
 * téléphone met plusieurs secondes à poser. « Tout voir » reste à un lien.
 */
const PAR_PAGE = 120;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tout?: string }>;
}) {
  const contexte = await exigerContexte();
  const { tout } = await searchParams;
  const total = await compterMedias(contexte.groupe.id);
  const medias = await mediasDeLaBande(contexte.groupe.id, tout ? total : PAR_PAGE);

  const videos = medias.filter((m) => m.genre === "video").length;
  const reste = total - medias.length;

  return (
    <div className="px-4 pt-3">
      <header className="mb-5 zone-sure-haute">
        <Link
          href="/souvenirs"
          className="mb-1 inline-flex items-center gap-1 text-[13px] text-encre-3 hover:text-encre-2"
        >
          <span aria-hidden>←</span> Les souvenirs
        </Link>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">La galerie</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">
          {medias.length === 0
            ? "Tout ce que la bande aura posté."
            : `${total} ${total > 1 ? "médias" : "média"}${videos > 0 ? `, dont ${videos} ${videos > 1 ? "vidéos" : "vidéo"}` : ""}.`}
        </p>
      </header>

      {medias.length === 0 ? (
        <Carte className="p-5">
          <Galerie medias={medias} profils={contexte.profils} />
        </Carte>
      ) : (
        <>
          <Galerie medias={medias} profils={contexte.profils} />
          {reste > 0 && (
            // Un lien, pas un bouton : ça marche sans JavaScript, et l'adresse
            // se partage entre nous telle quelle.
            <Link
              href="/galerie?tout=1"
              className="mt-6 block rounded-[var(--radius-pilule)] border border-trait py-3 text-center text-[14px] text-encre-2 transition hover:border-trait-fort"
            >
              Voir les {reste} plus {reste > 1 ? "anciens" : "ancien"}
            </Link>
          )}
        </>
      )}
    </div>
  );
}
