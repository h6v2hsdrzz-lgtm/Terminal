import { CarteEntree } from "@/composants/CarteEntree";
import { Carte, TitreSection } from "@/composants/Carte";
import { entreesDeLaBande, exigerContexte } from "@/lib/repaire";
import { enTexteRelatif, jourDeLaBande } from "@/lib/dates";
import type { Entree } from "@/lib/types";

/** Nombre de journées affichées d'un coup. La suite viendra au jalon 3. */
const JOURS_AFFICHES = 12;

export default async function Page() {
  const contexte = await exigerContexte();
  const aujourdhui = jourDeLaBande();
  const entrees = await entreesDeLaBande(contexte.groupe.id);
  const annuaire = { profils: contexte.profils, declencheurs: contexte.declencheurs };

  // Le fil se lit du plus récent au plus ancien, groupé par journée : c'est
  // la journée qui fait sens, pas l'entrée isolée. Le dépôt les rend déjà
  // triées, il n'y a qu'à les regrouper.
  const parJour = new Map<string, Entree[]>();
  for (const entree of entrees) {
    if (!parJour.has(entree.jour)) parJour.set(entree.jour, []);
    parJour.get(entree.jour)!.push(entree);
  }
  const jours = [...parJour.keys()].slice(0, JOURS_AFFICHES);

  return (
    <div className="px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Le fil</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">Tout ce que la bande a posé, jour après jour.</p>
      </header>

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
            const moyenne = duJour.reduce((s, e) => s + e.joie, 0) / duJour.length;
            return (
              <section key={jour}>
                <TitreSection
                  action={
                    <span className="chiffres text-[13px] text-encre-3">
                      {moyenne.toFixed(1).replace(".", ",")} de moyenne
                    </span>
                  }
                >
                  {enTexteRelatif(jour, aujourdhui)}
                </TitreSection>
                <div className="space-y-3">
                  {duJour.map((entree) => (
                    <CarteEntree key={entree.id} entree={entree} annuaire={annuaire} moi={contexte.moi.id} />
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
