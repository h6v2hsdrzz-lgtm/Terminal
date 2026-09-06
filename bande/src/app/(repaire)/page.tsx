import Link from "next/link";

import { CarteEntree } from "@/composants/CarteEntree";
import { Carte, TitreSection } from "@/composants/Carte";
import { FigureDuJour } from "@/composants/FigureDuJour";
import { PileScelles } from "@/composants/PileScelles";
import { listerCapsules, masquerEntree } from "@/lib/depot";
import { entreesDeLaBande, exigerContexte } from "@/lib/repaire";
import { enTexteRelatif, jourDeLaBande } from "@/lib/dates";
import type { Entree } from "@/lib/types";

/** Nombre de journées affichées d'un coup. La suite viendra au jalon 3. */
const JOURS_AFFICHES = 12;

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
 * navigateur suffisaient à le lire.
 */
export default async function Page() {
  const contexte = await exigerContexte();
  const aujourdhui = jourDeLaBande();
  const entrees = await entreesDeLaBande(contexte.groupe.id);
  const annuaire = { profils: contexte.profils, declencheurs: contexte.declencheurs };

  const maJournee = entrees.find((e) => e.jour === aujourdhui && e.profil === contexte.moi.id) ?? null;
  const voile = contexte.groupe.revelerApresPost && maJournee === null;
  // Qui est masqué : la carte doit le SAVOIR, pas seulement recevoir une
  // entrée vidée. Sans ça elle affiche un gros « 0 » là où il n'y a pas de
  // note — ce qui ne cache rien et raconte quelque chose de faux.
  const masques = new Set(
    voile
      ? entrees.filter((e) => e.jour === aujourdhui && e.profil !== contexte.moi.id).map((e) => e.id)
      : [],
  );
  // Seule la journée EN COURS est masquée. Le passé est déjà partagé : le voile
  // fait écrire sans se caler sur les autres, il n'efface pas ce qui a été lu
  // il y a une semaine.
  const visibles = entrees.map((e) => (masques.has(e.id) ? masquerEntree(e) : e));

  const capsules = await listerCapsules(contexte.groupe.id, contexte.moi.id, aujourdhui);
  const duJour = entrees.filter((e) => e.jour === aujourdhui);
  const notes = new Map<string, number | null>(
    contexte.profils.map((p) => [p.id, duJour.find((e) => e.profil === p.id)?.joie ?? null]),
  );

  // Le fil se lit du plus récent au plus ancien, groupé par journée : c'est
  // la journée qui fait sens, pas l'entrée isolée. Le dépôt les rend déjà
  // triées, il n'y a qu'à les regrouper.
  const parJour = new Map<string, Entree[]>();
  for (const entree of visibles) {
    if (!parJour.has(entree.jour)) parJour.set(entree.jour, []);
    parJour.get(entree.jour)!.push(entree);
  }
  const jours = [...parJour.keys()].slice(0, JOURS_AFFICHES);

  return (
    <div className="px-4 pt-3">
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
                <p className="mt-1 text-[13px] leading-snug text-encre-3">
                  {duJour.length === contexte.profils.length
                    ? "Vous y êtes tous."
                    : `${duJour.length} sur ${contexte.profils.length} pour l'instant.`}
                  {" "}Touche pour corriger, ajouter une photo ou un vocal.
                </p>
              </>
            )}
          </div>
          <span aria-hidden className="shrink-0 text-encre-3">→</span>
        </Carte>
      </Link>

      <PileScelles capsules={capsules} aujourdhui={aujourdhui} />

      {jours.length === 0 ? (
        <Carte className="p-5">
          <p className="text-[15px] leading-snug text-encre-2">
            Rien encore. Le fil se remplira tout seul, une journée à la fois.
          </p>
        </Carte>
      ) : (
        <div className="space-y-7">
          {jours.map((jour) => {
            const duJour = parJour.get(jour)!;
            // La moyenne ne se calcule que sur ce qu'on a le droit de lire.
            // Compter les journées masquées donnerait « 0,0 de moyenne », ce
            // qui ne cache rien et laisse croire à une journée épouvantable.
            const lisibles = duJour.filter((e) => !masques.has(e.id));
            const moyenne = lisibles.length
              ? lisibles.reduce((s, e) => s + e.joie, 0) / lisibles.length
              : null;
            return (
              <section key={jour}>
                <TitreSection
                  action={
                    moyenne !== null ? (
                      <span className="chiffres text-[13px] text-encre-3">
                        {moyenne.toFixed(1).replace(".", ",")} de moyenne
                      </span>
                    ) : undefined
                  }
                >
                  {enTexteRelatif(jour, aujourdhui)}
                </TitreSection>
                <div className="space-y-3">
                  {duJour.map((entree) => (
                    <CarteEntree
                      key={entree.id}
                      entree={entree}
                      annuaire={annuaire}
                      // Pas de `moi` sur une carte masquée : réagir à ce qu'on
                      // n'a pas lu n'a aucun sens.
                      moi={masques.has(entree.id) ? undefined : contexte.moi.id}
                      floute={masques.has(entree.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
