import { EcranAujourdhui } from "@/composants/EcranAujourdhui";
import { etiquettesDeLaBande, masquerEntree, poulsDeLaBande } from "@/lib/depot";
import { cadreAutomatique } from "@/lib/pouls";
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
  // Les étiquettes déjà posées par la bande, pour les proposer au lieu de les
  // faire retaper — et pour éviter « soirée » et « Soirée » côte à côte.
  const etiquettesConnues = await etiquettesDeLaBande(contexte.groupe.id);
  const duJour = entrees.filter((e) => e.jour === jour);
  const monEntree = duJour.find((e) => e.profil === contexte.moi.id) ?? null;

  // Le vidage se fait ici, sur le serveur : tout ce qui descend dans un
  // composant client est lisible par qui ouvre les outils du navigateur.
  const voile = contexte.groupe.revelerApresPost && monEntree === null;
  const visibles = voile
    ? duJour.map((e) => (e.profil === contexte.moi.id ? e : masquerEntree(e)))
    : duJour;

  /**
   * Les pouls, sur sept jours seulement.
   *
   * Le graphique n'en montre jamais plus, et tout charger pour n'en dessiner
   * sept serait exactement le défaut relevé dans l'audit technique.
   */
  const joursSemaine = Array.from({ length: 7 }, (_, i) => decaler(jour, i - 6));
  const pouls = await poulsDeLaBande(contexte.groupe.id, joursSemaine[0]);
  const miens = pouls.filter((p) => p.membreId === contexte.moi.id);
  const dernierPouls = miens.length > 0 ? miens[miens.length - 1] : null;

  return (
    <EcranAujourdhui
      jour={jour}
      nomBande={contexte.groupe.nom}
      annuaire={{ profils: contexte.profils, declencheurs: contexte.declencheurs }}
      moi={contexte.moi}
      monEntree={monEntree}
      entreesDuJour={visibles}
      serieCollective={serieCollective(new Set(entrees.map((e) => e.jour)), jour)}
      revelerApresPost={contexte.groupe.revelerApresPost}
      etiquettesConnues={etiquettesConnues}
      pouls={pouls}
      dernierPouls={dernierPouls ? { rire: dernierPouls.rire, energie: dernierPouls.energie } : null}
      joursSemaine={joursSemaine}
      cadrePouls={cadreAutomatique(pouls, jour)}
    />
  );
}
