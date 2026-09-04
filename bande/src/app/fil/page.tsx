import { CarteEntree } from "@/composants/CarteEntree";
import { TitreSection } from "@/composants/Carte";
import { ENTREES } from "@/lib/factices";
import { enTexteRelatif, jourDeLaBande } from "@/lib/dates";

export default function Page() {
  const aujourdhui = jourDeLaBande();

  // Le fil se lit du plus récent au plus ancien, groupé par journée : c'est
  // la journée qui fait sens, pas l'entrée isolée.
  const parJour = new Map<string, typeof ENTREES>();
  for (const entree of [...ENTREES].sort((a, b) => b.jour.localeCompare(a.jour))) {
    if (!parJour.has(entree.jour)) parJour.set(entree.jour, []);
    parJour.get(entree.jour)!.push(entree);
  }
  const jours = [...parJour.keys()].slice(0, 12);

  return (
    <div className="px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Le fil</h1>
        <p className="mt-0.5 text-[14px] text-encre-3">Tout ce que la bande a posé, jour après jour.</p>
      </header>

      <div className="space-y-7">
        {jours.map((jour) => {
          const entrees = parJour.get(jour)!;
          const moyenne = entrees.reduce((s, e) => s + e.joie, 0) / entrees.length;
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
                {entrees.map((entree) => (
                  <CarteEntree key={entree.id} entree={entree} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
