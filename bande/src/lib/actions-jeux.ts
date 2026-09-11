"use server";

import { revalidatePath } from "next/cache";

import { ErreurMetier } from "./depot";
import {
  abandonnerPartie,
  agir,
  ajouterCarte,
  cartesDeLaBande,
  chargerPartie,
  demarrerPartie,
  enregistrerManche,
  lancerPartie,
  lireEtatPartie,
  marquer,
  ouvrirSalon,
  publierPhase,
  quitterSalon,
  rejoindreSalon,
  reprendreLaMain,
  retirerCarte,
  terminerPartie,
  type CarteMaison,
  type EtatPartie,
  type FinDePartie,
  type Partie,
} from "./depot-jeux";
import { membreConnecte } from "./session";

/**
 * Les actions des jeux.
 *
 * Toutes passent par `quiJoue()` : une action de jeu qui ne vérifie pas la
 * session laisse n'importe qui marquer des points dans la partie de n'importe
 * quelle bande, et l'identifiant d'une partie finit toujours par se retrouver
 * dans une URL.
 *
 * Elles ne rafraîchissent pas le fil : une partie ne change rien à un journal,
 * et invalider sept chemins entre deux manches ferait clignoter l'écran de jeu
 * pour rien. Seul le profil est invalidé à la fin, parce que les points y
 * apparaissent.
 */
/**
 * Un fichier « use server » ne peut exporter que des fonctions asynchrones :
 * un objet constant exporté d'ici fait échouer la compilation du module
 * d'actions, et l'erreur ne pointe pas vers la ligne fautive. Le type, lui,
 * disparaît à la compilation et passe très bien.
 */
export type EtatJeu = { erreur: string | null };

async function quiJoue(): Promise<string> {
  const membreId = await membreConnecte();
  if (!membreId) throw new ErreurMetier("Ta session a expiré. Recharge la page.");
  return membreId;
}

async function tenter<T>(travail: () => Promise<T>): Promise<{ erreur: string | null; valeur?: T }> {
  try {
    return { erreur: null, valeur: await travail() };
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) return { erreur: erreur.message };
    throw erreur;
  }
}

export async function actionLancerPartie(
  jeu: string,
  joueurs: { membreId: string; sobre: boolean }[],
): Promise<{ erreur: string | null; valeur?: string }> {
  return tenter(async () => lancerPartie(await quiJoue(), jeu, joueurs));
}

export async function actionMarquer(
  partieId: string,
  points: { membreId: string; delta: number }[],
): Promise<EtatJeu> {
  return tenter(async () => {
    await marquer(await quiJoue(), partieId, points);
  });
}

export async function actionEnregistrerManche(
  partieId: string,
  manche: { membreId?: string | null; donnees: Record<string, unknown> },
): Promise<EtatJeu> {
  return tenter(async () => {
    await enregistrerManche(await quiJoue(), partieId, manche);
  });
}

export async function actionTerminerPartie(
  partieId: string,
): Promise<{ erreur: string | null; valeur?: FinDePartie }> {
  return tenter(async () => {
    const fin = await terminerPartie(await quiJoue(), partieId);
    // Les points de la partie s'affichent au profil : c'est le seul écran que
    // la fin d'une partie change.
    revalidatePath("/profil");
    revalidatePath("/jeux");
    return fin;
  });
}

export async function actionAbandonnerPartie(partieId: string): Promise<EtatJeu> {
  return tenter(async () => {
    await abandonnerPartie(await quiJoue(), partieId);
    revalidatePath("/jeux");
  });
}

/** Relire la partie — la barre de score s'en sert après chaque manche. */
export async function actionRelirePartie(
  partieId: string,
): Promise<{ erreur: string | null; valeur?: Partie | null }> {
  return tenter(async () => chargerPartie(await quiJoue(), partieId));
}

export async function actionAjouterCarte(
  paquet: string,
  texte: string,
): Promise<{ erreur: string | null; valeur?: CarteMaison }> {
  return tenter(async () => {
    const carte = await ajouterCarte(await quiJoue(), paquet, texte);
    revalidatePath("/jeux");
    return carte;
  });
}

export async function actionRetirerCarte(carteId: string): Promise<EtatJeu> {
  return tenter(async () => {
    await retirerCarte(await quiJoue(), carteId);
    revalidatePath("/jeux");
  });
}

export async function actionCartesDeLaBande(
  paquet: string,
): Promise<{ erreur: string | null; valeur?: CarteMaison[] }> {
  return tenter(async () => cartesDeLaBande(await quiJoue(), paquet));
}

// ── Le salon et la partie à plusieurs téléphones ────────────────────────────

export async function actionOuvrirSalon(
  jeu: string,
): Promise<{ erreur: string | null; valeur?: string }> {
  return tenter(async () => {
    const id = await ouvrirSalon(await quiJoue(), jeu);
    // L'accueil porte le bandeau « rejoindre » : sans cette invalidation, les
    // deux autres ne verraient le salon qu'au prochain rafraîchissement.
    revalidatePath("/");
    return id;
  });
}

export async function actionRejoindreSalon(
  reference: { partieId?: string; code?: string },
): Promise<{ erreur: string | null; valeur?: string }> {
  return tenter(async () => {
    const id = await rejoindreSalon(await quiJoue(), reference);
    revalidatePath("/");
    return id;
  });
}

export async function actionQuitterSalon(partieId: string): Promise<EtatJeu> {
  return tenter(async () => {
    await quitterSalon(await quiJoue(), partieId);
    revalidatePath("/");
  });
}

export async function actionDemarrerPartie(partieId: string): Promise<EtatJeu> {
  return tenter(async () => {
    await demarrerPartie(await quiJoue(), partieId);
    revalidatePath("/");
  });
}

/**
 * Publier une phase. Réservé à l'hôte — le dépôt le vérifie, pas l'écran.
 *
 * Aucune revalidation : c'est le flux qui prévient les écrans, et invalider un
 * chemin en plus ferait recharger la page sous les doigts au milieu d'une
 * manche.
 */
export async function actionPublierPhase(
  partieId: string,
  phase: { nom: string; manche?: number; donnees?: Record<string, unknown>; delai?: number | null },
): Promise<EtatJeu> {
  return tenter(async () => {
    await publierPhase(await quiJoue(), partieId, phase);
  });
}

export async function actionAgir(
  partieId: string,
  manche: number,
  phase: string,
  donnees: Record<string, unknown>,
): Promise<EtatJeu> {
  return tenter(async () => {
    await agir(await quiJoue(), partieId, manche, phase, donnees);
  });
}

/** L'état complet, pour le premier rendu. Ensuite, c'est le flux qui parle. */
export async function actionEtatPartie(
  partieId: string,
): Promise<{ erreur: string | null; valeur?: EtatPartie | null }> {
  return tenter(async () => lireEtatPartie(await quiJoue(), partieId));
}

/**
 * Prendre la main sur une partie dont l'hôte a disparu.
 *
 * Le dépôt refuse si l'hôte est encore là : l'écran peut donc proposer le
 * bouton sans risque, et sans avoir à trancher lui-même.
 */
export async function actionReprendreLaMain(
  partieId: string,
): Promise<{ erreur: string | null; valeur?: boolean }> {
  return tenter(async () => reprendreLaMain(await quiJoue(), partieId));
}
