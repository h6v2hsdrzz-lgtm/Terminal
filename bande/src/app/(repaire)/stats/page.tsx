import { Calendrier } from "@/composants/Calendrier";
import { Carte, TitreSection } from "@/composants/Carte";
import { Courbe } from "@/composants/Courbe";
import { couleurProfil } from "@/lib/couleurs";
import { SEUIL_CONCLUANT, effetDeclencheur, effetJourSemaine, moyenne, synchronicite } from "@/lib/analyse";
import { entreesDeLaBande, exigerContexte } from "@/lib/repaire";
import { NOMS_JOURS_COURTS, decaler, jourDeLaBande } from "@/lib/dates";

const FENETRE_COURBE = 30;

/** Demi-hauteur du graphique des écarts, en pixels. */
const DEMI_HAUTEUR = 46;
/**
 * Plancher de l'échelle des écarts.
 *
 * Le graphique s'ajuste à ses données, sinon des écarts d'un demi-point
 * dessinent des moignons dans un cadre vide. Mais il ne descend pas plus bas
 * que ce plancher : sans lui, une semaine parfaitement plate afficherait des
 * barres pleine hauteur pour des écarts de deux centièmes, et inventerait un
 * motif là où il n'y en a pas.
 */
const ECART_PLANCHER = 0.5;

/** Les jours de la semaine, en toutes lettres, pour commenter le graphique. */
const NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

export default async function Page() {
  const contexte = await exigerContexte();
  const aujourdhui = jourDeLaBande();
  const entrees = await entreesDeLaBande(contexte.groupe.id);

  const debut = decaler(aujourdhui, -(FENETRE_COURBE - 1));
  const recentes = entrees.filter((e) => e.jour >= debut);
  const jours = Array.from({ length: FENETRE_COURBE }, (_, i) => decaler(debut, i));

  const effets = contexte.declencheurs.map((d) => ({
    declencheur: d,
    effet: effetDeclencheur(entrees, d.id),
  }));

  const semaine = effetJourSemaine(entrees);
  const moyenneGenerale = moyenne(entrees.map((e) => e.joie));

  /**
   * Les écarts, arrondis une seule fois.
   *
   * Le graphique met en avant les extrêmes ; s'il les cherche sur les valeurs
   * brutes alors qu'il affiche des valeurs arrondies, deux jours affichés
   * « +0,6 » ne sont pas mis en avant pareil, et ça ressemble à un bug. On
   * compare donc ce qui est écrit.
   */
  const joursSemaine = semaine.map((j, index) => ({
    nom: NOMS_JOURS[index],
    court: NOMS_JOURS_COURTS[index],
    ecart: j.moyenne === null || moyenneGenerale === null ? null : j.moyenne - moyenneGenerale,
    arrondi: j.moyenne === null || moyenneGenerale === null
      ? null
      : Math.round((j.moyenne - moyenneGenerale) * 10) / 10,
  }));

  const arrondis = joursSemaine.map((j) => j.arrondi).filter((v) => v !== null);
  const hautSemaine = arrondis.length ? Math.max(...arrondis) : null;
  const basSemaine = arrondis.length ? Math.min(...arrondis) : null;
  const meilleursJours = joursSemaine.filter((j) => j.arrondi !== null && j.arrondi === hautSemaine).map((j) => j.nom);
  const piresJours = joursSemaine.filter((j) => j.arrondi !== null && j.arrondi === basSemaine).map((j) => j.nom);

  const echelleEcarts = Math.max(ECART_PLANCHER, ...arrondis.map(Math.abs));

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
    <div className="px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Les stats</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">
          {entrees.length === 0
            ? "Elles arriveront avec les premières journées."
            : `Ce que ${entrees.length} journées posées racontent.`}
        </p>
      </header>

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
        <TitreSection>Votre semaine</TitreSection>
        <Carte className="p-4">
          {/* Des écarts à la moyenne, pas des valeurs absolues.
              Toutes les moyennes tiennent entre 6 et 8 : sur une échelle qui
              part de 1, les sept barres sortaient à la même hauteur, et le
              lundi ressemblait trait pour trait au samedi juste en dessous
              d'une phrase qui disait le contraire. En partant de la moyenne, un
              écart de neuf dixièmes se voit enfin pour ce qu'il est. */}
          {moyenneGenerale === null ? (
            <p className="text-[14px] text-encre-2">Pas encore de journées à comparer.</p>
          ) : (
            <>
              <div className="relative flex items-stretch gap-2" style={{ height: 2 * DEMI_HAUTEUR }}>
                <span
                  className="absolute inset-x-0 border-t border-dashed border-trait-fort"
                  style={{ top: DEMI_HAUTEUR }}
                  aria-hidden
                />
                {joursSemaine.map((jour) => {
                  const ecart = jour.arrondi ?? 0;
                  const hauteur = Math.round((Math.abs(ecart) / echelleEcarts) * DEMI_HAUTEUR);
                  const extreme =
                    jour.arrondi !== null &&
                    (jour.arrondi === hautSemaine || jour.arrondi === basSemaine) &&
                    hautSemaine !== basSemaine;
                  return (
                    <div key={jour.court + jour.nom} className="relative flex-1">
                      <div
                        className={ecart >= 0 ? "absolute inset-x-0 rounded-t-lg" : "absolute inset-x-0 rounded-b-lg"}
                        style={{
                          height: Math.max(3, hauteur),
                          [ecart >= 0 ? "bottom" : "top"]: DEMI_HAUTEUR,
                          background: extreme ? "var(--joie-encre)" : "var(--surface-3)",
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="mt-1.5 flex gap-2">
                {joursSemaine.map((jour) => (
                  <div key={jour.court + jour.nom} className="flex-1 text-center">
                    <span className="block text-[11px] text-encre-3">{jour.court}</span>
                    <span className="chiffres block text-[11px] text-encre-3">
                      {jour.arrondi === null
                        ? "—"
                        : `${jour.arrondi >= 0 ? "+" : "−"}${Math.abs(jour.arrondi).toFixed(1).replace(".", ",")}`}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[13px] text-encre-3">
                {hautSemaine !== null && basSemaine !== null && hautSemaine !== basSemaine ? (
                  <>
                    Écarts à votre moyenne de{" "}
                    <span className="chiffres">{moyenneGenerale.toFixed(1).replace(".", ",")}</span>.{" "}
                    {meilleursJours.length === 1
                      ? `Le ${meilleursJours[0]} l'emporte`
                      : `Le ${meilleursJours.slice(0, -1).join(", le ")} et le ${meilleursJours.at(-1)} l'emportent`}
                    ,{" "}
                    {piresJours.length === 1
                      ? `le ${piresJours[0]} ferme la marche.`
                      : `le ${piresJours.slice(0, -1).join(", le ")} et le ${piresJours.at(-1)} ferment la marche.`}
                  </>
                ) : (
                  "Toutes vos journées se valent, à un dixième près."
                )}
              </p>
            </>
          )}
        </Carte>
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
