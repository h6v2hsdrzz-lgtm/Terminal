"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ErreurMetier,
  chargerContexte,
  creerBande,
  poserJournee,
  rejoindreBande,
  reprendreCompte,
} from "./depot";
import { fermerSession, garderCodeReprise, membreConnecte, oublierCodeReprise, ouvrirSession } from "./session";
import { ETAT_INITIAL, type Etat } from "./formulaire";
import { jourDeLaBande } from "./dates";

/**
 * Les actions serveur.
 *
 * Chacune rend un état plutôt que de lever : les formulaires les branchent sur
 * `useActionState`, et une erreur métier doit s'afficher dans le formulaire, pas
 * remplacer la page par un écran d'erreur. L'état lui-même est déclaré dans
 * `formulaire.ts` — un module « use server » n'exporte que des fonctions.
 */
function texte(donnees: FormData, cle: string): string {
  const valeur = donnees.get(cle);
  return typeof valeur === "string" ? valeur : "";
}

/** Traduit ce que l'utilisateur peut corriger ; laisse remonter le reste. */
async function tenter(travail: () => Promise<void>): Promise<Etat> {
  try {
    await travail();
  } catch (erreur) {
    if (erreur instanceof ErreurMetier) return { erreur: erreur.message };
    throw erreur;
  }
  return ETAT_INITIAL;
}

export async function actionCreerBande(_precedent: Etat, donnees: FormData): Promise<Etat> {
  const etat = await tenter(async () => {
    const nomBande = texte(donnees, "bande");
    const pseudo = texte(donnees, "pseudo");
    if (!nomBande.trim()) throw new ErreurMetier("Donne un nom à la bande.");
    if (!pseudo.trim()) throw new ErreurMetier("Dis-nous comment tu t'appelles.");

    const { membre, codeReprise } = await creerBande(nomBande, pseudo);
    await ouvrirSession(membre.id);
    await garderCodeReprise(codeReprise);
  });

  if (etat.erreur) return etat;
  // `redirect` lève : il doit rester hors du try, sinon il serait avalé.
  redirect("/bienvenue/code");
}

export async function actionRejoindre(_precedent: Etat, donnees: FormData): Promise<Etat> {
  const etat = await tenter(async () => {
    const invitation = texte(donnees, "invitation");
    const pseudo = texte(donnees, "pseudo");
    if (!invitation.trim()) throw new ErreurMetier("Entre le code que ton ami t'a donné.");
    if (!pseudo.trim()) throw new ErreurMetier("Dis-nous comment tu t'appelles.");

    const { membre, codeReprise } = await rejoindreBande(invitation, pseudo);
    await ouvrirSession(membre.id);
    await garderCodeReprise(codeReprise);
  });

  if (etat.erreur) return etat;
  redirect("/bienvenue/code");
}

export async function actionReprendre(_precedent: Etat, donnees: FormData): Promise<Etat> {
  const etat = await tenter(async () => {
    const membre = await reprendreCompte(texte(donnees, "reprise"));
    await ouvrirSession(membre.id);
  });

  if (etat.erreur) return etat;
  redirect("/");
}

export async function actionPoserJournee(_precedent: Etat, donnees: FormData): Promise<Etat> {
  return tenter(async () => {
    const membreId = await membreConnecte();
    if (!membreId) throw new ErreurMetier("Ta session a expiré. Recharge la page.");

    const contexte = await chargerContexte(membreId);
    if (!contexte) throw new ErreurMetier("Ce compte n'existe plus.");

    await poserJournee(membreId, contexte.groupe.id, jourDeLaBande(), {
      joie: Number(texte(donnees, "joie")),
      note: texte(donnees, "note"),
      declencheurs: donnees.getAll("declencheurs").filter((d): d is string => typeof d === "string"),
    });

    // Poser sa journée change les quatre écrans à la fois : le fil, les stats
    // et le profil ne sont pas « la page courante », mais ils sont faux dès
    // l'instant où l'entrée existe.
    for (const chemin of ["/", "/fil", "/stats", "/profil"]) revalidatePath(chemin);
  });
}

/** « J'ai noté » : le code disparaît du navigateur, et on entre dans le repaire. */
export async function actionCodeNote(): Promise<void> {
  await oublierCodeReprise();
  redirect("/");
}

export async function actionQuitter(): Promise<void> {
  await fermerSession();
  redirect("/bienvenue");
}
