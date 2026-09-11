import Link from "next/link";

import { CarteEntree } from "@/composants/CarteEntree";
import { Carte, TitreSection } from "@/composants/Carte";
import { FigureDuJour } from "@/composants/FigureDuJour";
import { PileScelles } from "@/composants/PileScelles";
import { Fil } from "@/composants/fil/Fil";
import { TirerPourRafraichir } from "@/composants/fil/TirerPourRafraichir";
import {
  aDejaPose,
  listerCapsules,
  listerEpinglees,
  listerPageDuFil,
  masquerEntree,
  toucherVisiteDuFil,
} from "@/lib/depot";
import { exigerContexte } from "@/lib/repaire";
import { jourDeLaBande } from "@/lib/dates";

/**
 * Le fil, et la première chose qu'on voit en ouvrant l'application.
 *
 * Il porte le voile, et ce n'est pas optionnel : tant qu'on n'a pas posé sa
 * journée, celles des autres restent muettes. Sans ça, ouvrir l'application
 * suffirait à lire tout le monde, et personne n'écrirait plus ce qu'il pense
 * vraiment. C'est la mécanique du produit, pas une décoration.
 *
 * Le vidage se fait ici, sur le serveur. La première version du voile floutait
 * en CSS : le texte partait dans le HTML, et trois clics dans les outils du
 * navigateur suffisaient à le lire. Rien n'a changé depuis que le défilement
 * est passé côté client — c'est la donnée qui est vidée, pas son affichage.
 *
 * Cette page ne charge plus l'historique entier pour en afficher douze jours :
 * une page de dix journées, et la suite à la demande.
 */
export default async function Page() {
  const contexte = await exigerContexte();
  const aujourdhui = jourDeLaBande();
  const annuaire = { profils: contexte.profils, declencheurs: contexte.declencheurs };

  const [page, epinglees, jaiPose, depuisVisite] = await Promise.all([
    listerPageDuFil(contexte.groupe.id),
    listerEpinglees(contexte.groupe.id),
    aDejaPose(contexte.groupe.id, contexte.moi.id, aujourdhui),
    // Lit la visite précédente ET marque celle-ci : le repère « nouveau »
    // n'a de sens qu'une fois, et il doit disparaître au rechargement suivant.
    toucherVisiteDuFil(contexte.moi.id),
  ]);

  const voile = contexte.groupe.revelerApresPost && !jaiPose;
  const duJour = page.journees.find((j) => j.jour === aujourdhui)?.entrees ?? [];
  const maJournee = duJour.find((e) => e.profil === contexte.moi.id) ?? null;

  // Qui est masqué : la carte doit le SAVOIR, pas seulement recevoir une
  // entrée vidée. Sans ça elle affiche un gros « 0 » là où il n'y a pas de
  // note — ce qui ne cache rien et raconte quelque chose de faux.
  const masques = voile
    ? duJour.filter((e) => e.profil !== contexte.moi.id).map((e) => e.id)
    : [];
  const caches = new Set(masques);

  // Seule la journée EN COURS est masquée. Le passé est déjà partagé : le voile
  // fait écrire sans se caler sur les autres, il n'efface pas ce qui a été lu
  // il y a une semaine.
  const premierePage = {
    ...page,
    journees: page.journees.map((journee) => ({
      ...journee,
      entrees: journee.entrees.map((e) => (caches.has(e.id) ? masquerEntree(e) : e)),
    })),
  };

  const capsules = await listerCapsules(contexte.groupe.id, contexte.moi.id, aujourdhui);
  const notes = new Map<string, number | null>(
    contexte.profils.map((p) => [p.id, duJour.find((e) => e.profil === p.id)?.joie ?? null]),
  );

  return (
    <div className="px-4 pt-3">
      <TirerPourRafraichir />

      <header className="mb-5 zone-sure-haute">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Le fil</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">Tout ce que la bande a posé, jour après jour.</p>
      </header>

      {/* La carte d'appel : la figure du jour, et le bouton qui mène au
          check-in. Elle reste après avoir posé — la figure est ce qu'on vient
          regarder — mais elle change de ton. */}
      <Link href="/aujourdhui" className="mb-6 block">
        <Carte className="flex items-center gap-4 p-4 transition hover:border-trait-fort">
          <FigureDuJour
            profils={contexte.profils}
            notes={notes}
            taille={104}
            libelles={false}
            masquee={voile}
            presents={duJour.map((e) => e.profil)}
          />
          <div className="min-w-0 flex-1">
            {maJournee === null ? (
              <>
                <p className="text-[16px] font-semibold leading-tight">Pose ta journée</p>
                <p className="mt-1 text-[13px] leading-snug text-encre-3">
                  {voile && duJour.length > 0
                    ? "Les autres sont passés. Leurs journées se dévoilent quand tu as posé la tienne."
                    : "Dix secondes : une note, et ce que tu veux en dire."}
                </p>
              </>
            ) : (
              <>
                <p className="text-[16px] font-semibold leading-tight">C&apos;est posé.</p>
                {/* Plus de décompte « vous y êtes tous » : il disait la même
                    chose tous les soirs, et la figure du jour juste au-dessus
                    le montre déjà, en mieux. */}
                <p className="mt-1 text-[13px] leading-snug text-encre-3">
                  Touche pour corriger, ajouter une photo ou un vocal.
                </p>
              </>
            )}
          </div>
          <span aria-hidden className="shrink-0 text-encre-3">→</span>
        </Carte>
      </Link>

      <PileScelles capsules={capsules} aujourdhui={aujourdhui} />

      {/* Les épinglées, hors du défilement : elles ne bougent pas, et elles
          ne comptent pas dans la pagination. Une journée voilée n'y apparaît
          jamais — épingler ne contourne pas le voile. */}
      {epinglees.filter((e) => !caches.has(e.id)).length > 0 && (
        <section className="mb-7">
          <TitreSection>Épinglées</TitreSection>
          <div className="space-y-3">
            {epinglees
              .filter((e) => !caches.has(e.id))
              .map((entree) => (
                <CarteEntree
                  key={entree.id}
                  entree={entree}
                  annuaire={annuaire}
                  moi={contexte.moi.id}
                />
              ))}
          </div>
        </section>
      )}

      <Fil
        premierePage={premierePage}
        annuaire={annuaire}
        moi={contexte.moi.id}
        bande={contexte.groupe.nom}
        aujourdhui={aujourdhui}
        masques={masques}
        depuisVisite={depuisVisite}
      />
    </div>
  );
}
