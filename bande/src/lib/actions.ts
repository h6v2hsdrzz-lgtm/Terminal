"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ErreurMetier,
  ajouterDeclencheur,
  basculerReaction,
  chargerContexte,
  commenter,
  creerBande,
  poserJournee,
  reglerDevoilement,
  rejoindreBande,
  renommerBande,
  enregistrerPhoto,
  quitterBande,
  reprendreCompte,
  retirerDeclencheur,
  retirerPhoto,
  supprimerCommentaire,
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
    const { membreId, contexte } = await quiAgit();
    await poserJournee(membreId, contexte.groupe.id, jourDeLaBande(), {
      joie: Number(texte(donnees, "joie")),
      note: texte(donnees, "note"),
      declencheurs: donnees.getAll("declencheurs").filter((d): d is string => typeof d === "string"),
    });

    rafraichirTout();
  });
}

/**
 * Toute écriture change plusieurs écrans à la fois.
 *
 * Le fil, les stats et le profil ne sont jamais « la page courante » quand on
 * pose une journée, mais ils deviennent faux à l'instant où la ligne existe.
 */
function rafraichirTout() {
  for (const chemin of ["/", "/fil", "/stats", "/profil", "/reglages", "/souvenirs"]) {
    revalidatePath(chemin);
  }
}

/** L'identité de celui qui agit, et sa bande. Toute action passe par là. */
async function quiAgit() {
  const membreId = await membreConnecte();
  if (!membreId) throw new ErreurMetier("Ta session a expiré. Recharge la page.");
  const contexte = await chargerContexte(membreId);
  if (!contexte) throw new ErreurMetier("Ce compte n'existe plus.");
  return { membreId, contexte };
}

export async function actionReagir(entreeId: string, emoji: string): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await basculerReaction(membreId, entreeId, emoji);
    rafraichirTout();
  });
}

export async function actionCommenter(_precedent: Etat, donnees: FormData): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await commenter(membreId, texte(donnees, "entree"), texte(donnees, "texte"));
    rafraichirTout();
  });
}

export async function actionSupprimerCommentaire(commentaireId: string): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await supprimerCommentaire(membreId, commentaireId);
    rafraichirTout();
  });
}

// ── Réglages de la bande ─────────────────────────────────────────────────────

export async function actionRenommerBande(_precedent: Etat, donnees: FormData): Promise<Etat> {
  return tenter(async () => {
    const { contexte } = await quiAgit();
    await renommerBande(contexte.groupe.id, texte(donnees, "nom"));
    rafraichirTout();
  });
}

export async function actionReglerDevoilement(reveler: boolean): Promise<Etat> {
  return tenter(async () => {
    const { contexte } = await quiAgit();
    await reglerDevoilement(contexte.groupe.id, reveler);
    rafraichirTout();
  });
}

export async function actionAjouterDeclencheur(_precedent: Etat, donnees: FormData): Promise<Etat> {
  return tenter(async () => {
    const { contexte } = await quiAgit();
    await ajouterDeclencheur(contexte.groupe.id, texte(donnees, "nom"), texte(donnees, "emoji"));
    rafraichirTout();
  });
}

export async function actionRetirerDeclencheur(declencheurId: string): Promise<Etat> {
  return tenter(async () => {
    const { contexte } = await quiAgit();
    await retirerDeclencheur(contexte.groupe.id, declencheurId);
    rafraichirTout();
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

// ── Photos ──────────────────────────────────────────────────────────────────

export async function actionEnvoyerPhoto(_precedent: Etat, donnees: FormData): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    const fichier = donnees.get("photo");
    if (!(fichier instanceof File) || fichier.size === 0) {
      throw new ErreurMetier("Choisis une image.");
    }

    await enregistrerPhoto(membreId, jourDeLaBande(), {
      mime: fichier.type,
      octets: new Uint8Array(await fichier.arrayBuffer()),
      largeur: Number(texte(donnees, "largeur")) || 0,
      hauteur: Number(texte(donnees, "hauteur")) || 0,
    });
    rafraichirTout();
  });
}

export async function actionRetirerPhoto(): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await retirerPhoto(membreId, jourDeLaBande());
    rafraichirTout();
  });
}

// ── Partir ──────────────────────────────────────────────────────────────────

/**
 * Quitter la bande pour de bon : les journées, les réactions et les
 * commentaires partent avec la personne. Irréversible, et l'écran le dit
 * clairement avant d'y arriver.
 */
export async function actionQuitterLaBande(_precedent: Etat, donnees: FormData): Promise<Etat> {
  const etat = await tenter(async () => {
    const { membreId, contexte } = await quiAgit();
    // On demande de recopier le nom de la bande : un bouton seul se clique par
    // erreur, une phrase à retaper ne s'écrit pas par accident.
    if (texte(donnees, "confirmation").trim() !== contexte.groupe.nom) {
      throw new ErreurMetier("Le nom recopié ne correspond pas. Rien n'a été supprimé.");
    }
    await quitterBande(membreId);
    await fermerSession();
  });

  if (etat.erreur) return etat;
  redirect("/bienvenue");
}
