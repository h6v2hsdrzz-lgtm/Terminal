import { EcranAujourdhui } from "@/composants/EcranAujourdhui";
import { entreesDeLaBande, exigerContexte } from "@/lib/repaire";
import { decaler, jourDeLaBande } from "@/lib/dates";

/** Jours consécutifs où au moins une personne a posté, en remontant. */
function serieCollective(jours: Set<string>, depuis: string): number {
  // La journée en cours ne compte pas contre la bande tant qu'elle n'est pas
  // finie : si personne n'a encore posté ce soir, on repart d'hier.
  let curseur = jours.has(depuis) ? depuis : decaler(depuis, -1);
  let compte = 0;
  while (jours.has(curseur)) {
    compte += 1;
    curseur = decaler(curseur, -1);
  }
  return compte;
}

export default async function Page() {
  const contexte = await exigerContexte();
  const jour = jourDeLaBande();

  // La série se calcule sur l'historique, pas sur les seules entrées du jour.
  const entrees = await entreesDeLaBande(contexte.groupe.id);
  const duJour = entrees.filter((e) => e.jour === jour);

  return (
    <EcranAujourdhui
      jour={jour}
      nomBande={contexte.groupe.nom}
      annuaire={{ profils: contexte.profils, declencheurs: contexte.declencheurs }}
      moi={contexte.moi}
      monEntree={duJour.find((e) => e.profil === contexte.moi.id) ?? null}
      entreesDuJour={duJour}
      serieCollective={serieCollective(new Set(entrees.map((e) => e.jour)), jour)}
      revelerApresPost={contexte.groupe.revelerApresPost}
    />
  );
}
