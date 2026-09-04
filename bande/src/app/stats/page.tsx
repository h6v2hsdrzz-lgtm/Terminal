import { Calendrier } from "@/composants/Calendrier";
import { Carte, TitreSection } from "@/composants/Carte";
import { Courbe } from "@/composants/Courbe";
import { couleurProfil } from "@/lib/couleurs";
import { effetDeclencheur, effetJourSemaine, synchronicite } from "@/lib/analyse";
import { DECLENCHEURS, ENTREES, PROFILS } from "@/lib/factices";
import { NOMS_JOURS_COURTS, decaler, jourDeLaBande } from "@/lib/dates";

export default function Page() {
  const aujourdhui = jourDeLaBande();
  const debut = decaler(aujourdhui, -29);
  const recentes = ENTREES.filter((e) => e.jour >= debut);
  const jours = Array.from({ length: 30 }, (_, i) => decaler(debut, i));

  const effets = DECLENCHEURS.map((d) => ({ declencheur: d, effet: effetDeclencheur(ENTREES, d.id) }));
  const semaine = effetJourSemaine(ENTREES);
  const maxSemaine = Math.max(...semaine.map((j) => j.moyenne ?? 0));
  const minSemaine = Math.min(...semaine.filter((j) => j.moyenne !== null).map((j) => j.moyenne!));
  const duo = synchronicite(ENTREES, PROFILS[0].id, PROFILS[1].id);

  return (
    <div className="px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Les stats</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">Ce que 90 jours de journées racontent.</p>
      </header>

      <section>
        <TitreSection action={<span className="text-[13px] text-encre-3">30 derniers jours</span>}>
          Évolution
        </TitreSection>
        <Carte className="p-4">
          <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {PROFILS.map((profil) => (
              <li key={profil.id} className="flex items-center gap-1.5 text-[13px] text-encre-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: couleurProfil(profil) }}
                />
                {profil.pseudo}
              </li>
            ))}
          </ul>
          <Courbe entrees={recentes} profils={PROFILS} jours={jours} />
        </Carte>
      </section>

      <section className="mt-7">
        <TitreSection>Les jours de la bande</TitreSection>
        <Carte className="p-4">
          <div className="flex justify-center">
            <Calendrier entrees={ENTREES} jusquA={aujourdhui} />
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
                ) : Math.abs(effet.ecart) < 0.15 ? (
                  // « +0,0 » ressemble à un résultat alors que c'est une absence
                  // de résultat. On le dit avec des mots.
                  <span className="text-[12px] text-encre-3">aucun effet visible</span>
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
                </p>
              ) : (
                <p className="mt-1.5 text-[13px] text-encre-3">
                  {Math.min(effet.joursAvec, effet.joursSans)} jour
                  {Math.min(effet.joursAvec, effet.joursSans) > 1 ? "s" : ""} d&apos;un côté :
                  il en faut au moins {5} pour dire quoi que ce soit.
                </p>
              )}
            </Carte>
          ))}
        </div>
      </section>

      <section className="mt-7">
        <TitreSection>Votre semaine</TitreSection>
        <Carte className="p-4">
          {/* Hauteurs calculées en pixels : en pourcentage, elles se
              rapportaient à un parent sans hauteur définie et aucune barre ne
              se dessinait. */}
          <div className="flex items-end gap-2">
            {semaine.map((jour, index) => {
              const part = jour.moyenne === null ? 0 : (jour.moyenne - 1) / 9;
              const extreme =
                jour.moyenne !== null &&
                (jour.moyenne === maxSemaine || jour.moyenne === minSemaine);
              return (
                <div key={index} className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className="w-full rounded-t-lg"
                    style={{
                      height: Math.max(6, Math.round(part * 92)),
                      background: extreme ? "var(--joie-encre)" : "var(--surface-3)",
                    }}
                  />
                  <span className="text-[11px] text-encre-3">{NOMS_JOURS_COURTS[index]}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[13px] text-encre-3">
            Vos meilleurs jours ressortent en foncé. Rien d&apos;étonnant pour un samedi.
          </p>
        </Carte>
      </section>

      <section className="mt-7">
        <TitreSection>Synchronicité</TitreSection>
        <Carte className="p-4">
          {duo.concluant && duo.coefficient !== null ? (
            <>
              {/* Une corrélation de 0,56 ne veut pas dire « 56 % du temps » —
                  c'est la formulation qui vient naturellement, et elle est
                  fausse. On garde la phrase qui lance le débat, et on donne le
                  chiffre pour ce qu'il est. */}
              <p className="text-[15px] leading-snug">
                Quand <b>{PROFILS[0].pseudo}</b> monte, <b>{PROFILS[1].pseudo}</b>{" "}
                {Math.abs(duo.coefficient) > 0.5 ? "monte souvent aussi" : "ne suit pas vraiment"}.
              </p>
              <p className="mt-1.5 text-[13px] text-encre-3">
                Corrélation de{" "}
                <span className="chiffres" style={{ color: "var(--joie-encre)" }}>
                  {duo.coefficient.toFixed(2).replace(".", ",")}
                </span>{" "}
                sur {duo.joursCommuns} journées où vous avez posté tous les deux. Au-delà
                de 0,5, les deux courbes bougent nettement ensemble.
              </p>
            </>
          ) : (
            <p className="text-[14px] leading-snug text-encre-2">
              Encore trop peu de journées communes pour comparer deux courbes sans
              raconter n&apos;importe quoi. Il en faut une trentaine — vous en êtes à{" "}
              {duo.joursCommuns}.
            </p>
          )}
        </Carte>
      </section>
    </div>
  );
}
