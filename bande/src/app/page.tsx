import { EcranAujourdhui } from "@/composants/EcranAujourdhui";
import { ENTREES } from "@/lib/factices";
import { decaler, jourDeLaBande } from "@/lib/dates";

/** Jours consécutifs où au moins une personne a posté, en remontant. */
function serieCollective(jours: Set<string>, depuis: string): number {
  let curseur = depuis;
  if (!jours.has(curseur)) curseur = decaler(curseur, -1);
  let compte = 0;
  while (jours.has(curseur)) {
    compte += 1;
    curseur = decaler(curseur, -1);
  }
  return compte;
}

export default function Page() {
  const jour = jourDeLaBande();
  const entreesDuJour = ENTREES.filter((e) => e.jour === jour);
  const jours = new Set(ENTREES.map((e) => e.jour));

  return (
    <EcranAujourdhui
      jour={jour}
      entreesDuJour={entreesDuJour}
      serieCollective={serieCollective(jours, jour)}
    />
  );
}
