import { Calendrier } from "@/composants/Calendrier";
import { Carte, TitreSection } from "@/composants/Carte";
import { Courbe } from "@/composants/Courbe";
import { couleurProfil } from "@/lib/couleurs";
import { SEUIL_CONCLUANT, effetDeclencheur, synchronicite } from "@/lib/analyse";
import { decaler } from "@/lib/dates";
import type { Declencheur, Entree, Profil } from "@/lib/types";

const FENETRE_COURBE = 30;

/**
 * Les statistiques de la bande.
 *
 * Elles vivaient sur leur propre écran et ont rejoint les souvenirs : c'est là
 * qu'on vient pour regarder en arrière, et un onglet dédié faisait d'elles une
 * destination alors qu'elles sont une lecture.
 *
 * Quatre lectures, pas douze : l'évolution, le calendrier, l'effet des
 * déclencheurs, la synchronicité. Le graphique des jours de la semaine a été
 * retiré — il disait rarement quelque chose et occupait un écran entier.
 */
export function Stats({
  entrees,
  profils,
  declencheurs,
  aujourdhui,
}: {
  entrees: Entree[];
  profils: Profil[];
  declencheurs: Declencheur[];
  aujourdhui: string;
}) {
  const contexte = { profils, declencheurs };

  const debut = decaler(aujourdhui, -(FENETRE_COURBE - 1));
  const recentes = entrees.filter((e) => e.jour >= debut);
  const jours = Array.from({ length: FENETRE_COURBE }, (_, i) => decaler(debut, i));

  const effets = declencheurs.map((d) => ({
    declencheur: d,
    effet: effetDeclencheur(entrees, d.id),
  }));


  // La synchronicité se lit entre deux personnes. À plus de deux, on prend la
  // paire la plus liée : c'est celle qui a quelque chose à raconter.
  const duos = [];
  for (let i = 0; i < contexte.profils.length; i += 1) {
    for (let j = i + 1; j < contexte.profils.length; j += 1) {
      duos.push({
        a: contexte.profils[i],
        b: contexte.profils[j],
        mesure: synchronicite(entrees, contexte.profils[i].id, contexte.profils[j].id),
      });
    }
  }
  const duo = duos
    .filter((d) => d.mesure.concluant)
    .sort((x, y) => Math.abs(y.mesure.coefficient!) - Math.abs(x.mesure.coefficient!))[0]
    ?? duos[0];

  return (
    <div id="stats" className="scroll-mt-4">
      <TitreSection
        action={
          <span className="text-[13px] text-encre-3">
            {entrees.length === 0 ? "" : `${entrees.length} journées`}
          </span>
        }
      >
        Les stats
      </TitreSection>

      <section>
        <TitreSection action={<span className="text-[13px] text-encre-3">{FENETRE_COURBE} derniers jours</span>}>
          Évolution
        </TitreSection>
        <Carte className="p-4">
          {/* La légende nomme chaque personne à côté de sa pastille : la
              couleur seule ne suffit pas à distinguer sept courbes pour un œil
              daltonien, et c'est la condition à laquelle la palette a été
              validée. */}
          <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {contexte.profils.map((profil) => (
              <li key={profil.id} className="flex items-center gap-1.5 text-[13px] text-encre-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: couleurProfil(profil) }}
                />
                {profil.pseudo}
              </li>
            ))}
          </ul>
          <Courbe entrees={recentes} profils={contexte.profils} jours={jours} />
        </Carte>
      </section>

      <section className="mt-7">
        <TitreSection>Les jours de la bande</TitreSection>
        <Carte className="p-4">
          <div className="flex justify-center">
            <Calendrier entrees={entrees} jusquA={aujourdhui} />
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-encre-3">
            <span>plus calme</span>
            {[2, 4, 6, 8, 10].map((palier) => (
              <span
                key={palier}
                className="h-[11px] w-[11px] rounded-[3px]"
                style={{ background: `var(--joie-${palier})` }}
              />
            ))}
            <span>plus haut</span>
          </div>
        </Carte>
      </section>

      <section className="mt-7">
        <TitreSection>Effet des déclencheurs</TitreSection>
        <div className="space-y-3">
          {effets.map(({ declencheur, effet }) => (
            <Carte key={declencheur.id} className="p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-semibold tracking-tight">
                  {declencheur.emoji} {declencheur.nom}
                </span>
                {!effet.concluant || effet.ecart === null ? (
                  <span className="text-[12px] text-encre-3">pas encore concluant</span>
                ) : !effet.net ? (
                  // « +0,2 » a exactement l'air d'un résultat, et c'est ce que
                  // deux séries tirées au hasard produisent une fois sur trois.
                  // Tant que l'écart ne dépasse pas son incertitude, on le dit
                  // avec des mots plutôt qu'avec un chiffre.
                  <span className="text-[12px] text-encre-3">rien de net</span>
                ) : (
                  <span
                    className="chiffres text-[19px]"
                    style={{ color: effet.ecart > 0 ? "var(--joie-encre)" : "var(--encre-2)" }}
                  >
                    {effet.ecart > 0 ? "+" : "−"}
                    {Math.abs(effet.ecart).toFixed(1).replace(".", ",")}
                  </span>
                )}
              </div>

              {effet.concluant ? (
                <p className="mt-1.5 text-[13px] text-encre-3">
                  avec : {effet.avec!.toFixed(1).replace(".", ",")} sur {effet.joursAvec} jours ·
                  sans : {effet.sans!.toFixed(1).replace(".", ",")} sur {effet.joursSans} jours
                  {effet.incertitude !== null && (
                    <> · à ± {effet.incertitude.toFixed(1).replace(".", ",")} près</>
                  )}
                </p>
              ) : (
                <p className="mt-1.5 text-[13px] text-encre-3">
                  {Math.min(effet.joursAvec, effet.joursSans)} jour
                  {Math.min(effet.joursAvec, effet.joursSans) > 1 ? "s" : ""} d&apos;un côté :
                  il en faut au moins {SEUIL_CONCLUANT} pour dire quoi que ce soit.
                </p>
              )}
            </Carte>
          ))}
        </div>
      </section>

      <section className="mt-7">
        <TitreSection>Synchronicité</TitreSection>
        <Carte className="p-4">
          {duo && duo.mesure.concluant && duo.mesure.coefficient !== null ? (
            <>
              {/* Une corrélation de 0,56 ne veut pas dire « 56 % du temps » —
                  c'est la formulation qui vient naturellement, et elle est
                  fausse. On garde la phrase qui lance le débat, et on donne le
                  chiffre pour ce qu'il est. */}
              <p className="text-[15px] leading-snug">
                Quand <b>{duo.a.pseudo}</b> monte, <b>{duo.b.pseudo}</b>{" "}
                {Math.abs(duo.mesure.coefficient) > 0.5 ? "monte souvent aussi" : "ne suit pas vraiment"}.
              </p>
              <p className="mt-1.5 text-[13px] text-encre-3">
                Corrélation de{" "}
                <span className="chiffres" style={{ color: "var(--joie-encre)" }}>
                  {duo.mesure.coefficient.toFixed(2).replace(".", ",")}
                </span>{" "}
                sur {duo.mesure.joursCommuns} journées où vous avez posté tous les deux. Au-delà
                de 0,5, les deux courbes bougent nettement ensemble.
              </p>
            </>
          ) : (
            <p className="text-[14px] leading-snug text-encre-2">
              Encore trop peu de journées communes pour comparer deux courbes sans
              raconter n&apos;importe quoi. Il en faut une trentaine — vous en êtes à{" "}
              {duo?.mesure.joursCommuns ?? 0}.
            </p>
          )}
        </Carte>
      </section>
    </div>
  );
}
