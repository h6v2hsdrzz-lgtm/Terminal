import Link from "next/link";

import { Carte, TitreSection } from "@/composants/Carte";
import { FicheJeu } from "@/composants/jeux/FicheJeu";
import { CATEGORIES, jeuParCle, jeuxDeCategorie } from "@/lib/jeux/catalogue";
import { historiqueParties, partieEnCours } from "@/lib/depot-jeux";
import { exigerContexte } from "@/lib/repaire";

/**
 * Les jeux.
 *
 * Dix jeux rangés en quatre catégories, chacun avec ses règles **lisibles
 * avant de lancer**. C'est la seule chose que le plan répète deux fois, et il a
 * raison : personne ne lit une règle en cours de partie, et un jeu qu'on
 * n'a pas compris devient un jeu qu'on n'a pas aimé.
 *
 * Une seule partie à la fois pour la bande. À trois autour d'une table, deux
 * parties en parallèle ne veulent rien dire — et ça évite qu'un
 * rafraîchissement de page en ouvre une seconde par accident.
 */
export default async function Page() {
  const contexte = await exigerContexte();
  const encours = await partieEnCours(contexte.moi.id);
  const historique = await historiqueParties(contexte.moi.id);

  return (
    <div className="px-4 pt-3">
      <header className="mb-5 zone-sure-haute">
        <h1 className="text-[26px] font-semibold tracking-tight">Les jeux</h1>
        <p className="mt-1 text-[14px] text-encre-2">
          À trois, sur un seul téléphone qu&apos;on se passe.
        </p>
      </header>

      {encours && (
        <Carte className="mb-6 p-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
            Partie en cours
          </p>
          <p className="mt-1.5 text-[17px] font-semibold tracking-tight">
            {jeuParCle(encours.jeu)?.nom ?? encours.jeu}
          </p>
          <p className="mt-1 text-[14px] text-encre-2">
            {encours.joueurs.map((j) => `${j.pseudo} ${j.points}`).join(" · ")}
          </p>
          <Link
            href={`/jeux/${encours.id}`}
            className="cible-tactile mt-3 inline-flex items-center justify-center rounded-[var(--radius-pilule)] bg-encre px-4 py-2.5 text-[15px] font-semibold text-surface"
          >
            Reprendre
          </Link>
        </Carte>
      )}

      {CATEGORIES.map((categorie) => (
        <section key={categorie.cle} className="mb-7">
          <TitreSection>{categorie.nom}</TitreSection>
          <p className="mb-3 px-1 text-[13px] text-encre-3">{categorie.sous}</p>
          <ul className="space-y-2.5">
            {jeuxDeCategorie(categorie.cle).map((jeu) => (
              <li key={jeu.cle}>
                <FicheJeu
                  jeu={jeu}
                  profils={contexte.profils}
                  moiId={contexte.moi.id}
                  bloque={encours !== null}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {historique.length > 0 && (
        <section className="mb-8">
          <TitreSection>Les dernières parties</TitreSection>
          <Carte className="divide-y divide-trait">
            {historique.map((partie) => (
              <p key={partie.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-[15px]">{jeuParCle(partie.jeu)?.nom ?? partie.jeu}</span>
                <span className="text-[13px] text-encre-3">
                  {partie.gagnant ? `${partie.gagnant} devant` : "sans vainqueur"}
                </span>
              </p>
            ))}
          </Carte>
        </section>
      )}
    </div>
  );
}
