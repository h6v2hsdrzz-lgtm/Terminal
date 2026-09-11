import Link from "next/link";

import { Carte } from "@/composants/Carte";
import { Galerie } from "@/composants/Galerie";
import { compterMedias, mediasDeLaBande } from "@/lib/depot";
import { MEDIAS_PAR_PAGE, borneGalerie } from "@/lib/media";
import { exigerContexte } from "@/lib/repaire";

/**
 * La galerie : tout ce que la bande a posté, sans les journées autour.
 *
 * Elle n'a pas d'onglet à elle. Cinq onglets remplissent déjà la largeur d'un
 * iPhone, et un sixième rendrait les libellés illisibles — on y entre depuis
 * les souvenirs, qui est l'écran où l'on vient pour regarder en arrière.
 */
/**
 * Elle se charge par pages, et « tout voir » n'existe plus.
 *
 * Les vignettes se chargent au fil du défilement, mais le DOCUMENT, lui, était
 * rendu en entier : sur une bande de trois ans, « tout voir » posait plusieurs
 * milliers de cases d'un coup — le téléphone bloque, et la mémoire se remplit
 * d'images que personne ne regardera. La borne est dans `borneGalerie`, avec
 * ses tests et la raison de ne pas avoir virtualisé.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const contexte = await exigerContexte();
  const { page } = await searchParams;
  const total = await compterMedias(contexte.groupe.id);
  const { combien, suivante } = borneGalerie(page ?? 1, total);
  const medias = await mediasDeLaBande(contexte.groupe.id, combien);

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
          {suivante !== null && (
            // Un lien, pas un bouton : ça marche sans JavaScript, et l'adresse
            // se partage entre nous telle quelle. Il ajoute UNE page, jamais
            // tout le reste.
            <Link
              href={`/galerie?page=${suivante}`}
              className="mt-6 block rounded-[var(--radius-pilule)] border border-trait py-3 text-center text-[14px] text-encre-2 transition hover:border-trait-fort"
            >
              Voir {Math.min(MEDIAS_PAR_PAGE, reste)} de plus
              <span className="text-encre-3"> · il en reste {reste}</span>
            </Link>
          )}
        </>
      )}
    </div>
  );
}
