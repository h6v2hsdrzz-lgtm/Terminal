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
  poserPouls,
  reglerDevoilement,
  rejoindreBande,
  renommerBande,
  renommerMembre,
  enregistrerAvatar,
  retirerAvatar,
  ecrireCapsule,
  ajouterMedia,
  enregistrerAudio,
  retirerAudio,
  quitterBande,
  reprendreCompte,
  retirerDeclencheur,
  retirerMedia,
  legender,
  supprimerCapsule,
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

/**
 * Un champ qu'on a le droit de ne pas remplir.
 *
 * Le champ absent et le champ vide veulent dire la même chose — « je n'ai pas
 * répondu » — et ce n'est pas zéro : un zéro serait une réponse.
 */
function nombreFacultatif(donnees: FormData, cle: string): number | null {
  const brut = texte(donnees, cle).trim();
  if (!brut) return null;
  const valeur = Number(brut);
  return Number.isFinite(valeur) ? valeur : null;
}

/**
 * Le lieu géolocalisé, s'il y en a un.
 *
 * Il arrive en un seul champ caché — « nom|latitude|longitude » — parce que le
 * formulaire marche sans JavaScript et qu'un champ de plus par lieu serait un
 * champ de plus à tenir. Une valeur mal formée est ignorée : le lieu reste, il
 * n'a simplement pas de point sur la carte.
 */
function positionDuLieu(donnees: FormData): { nom: string; latitude: number; longitude: number } | null {
  const brut = texte(donnees, "lieuPosition");
  if (!brut) return null;
  const [nom, la, lo] = brut.split("|");
  const latitude = Number(la);
  const longitude = Number(lo);
  if (!nom || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { nom, latitude, longitude };
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
      titre: texte(donnees, "titre"),
      // Les étiquettes arrivent en une seule chaîne séparée par des virgules :
      // un champ de texte marche partout, là où une liste de champs cachés
      // dépend du JavaScript pour exister.
      etiquettes: texte(donnees, "etiquettes").split(",").map((e) => e.trim()).filter(Boolean),
      energie: nombreFacultatif(donnees, "energie"),
      calme: nombreFacultatif(donnees, "calme"),
      position: positionDuLieu(donnees),
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
  for (const chemin of ["/", "/aujourdhui", "/stats", "/profil", "/reglages", "/souvenirs", "/galerie"]) {
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

/**
 * Changer son pseudo.
 *
 * Il apparaît partout — les cartes du fil, les avatars, les commentaires, les
 * statistiques — et nulle part il n'est recopié : rafraîchir tous les écrans
 * suffit à le voir changer jusque dans les journées d'il y a un an.
 */
export async function actionRenommerMembre(_precedent: Etat, donnees: FormData): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await renommerMembre(membreId, texte(donnees, "pseudo"));
    rafraichirTout();
  });
}

/** Sans JavaScript : une soumission classique attend une navigation. */
export async function actionRenommerMembreSimple(donnees: FormData): Promise<void> {
  await actionRenommerMembre(ETAT_INITIAL, donnees);
  redirect("/profil");
}

/** Sa photo de profil. Le navigateur l'a déjà recadrée et compressée. */
export async function actionEnvoyerAvatar(_precedent: Etat, donnees: FormData): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    const fichier = donnees.get("avatar");
    if (!(fichier instanceof File) || fichier.size === 0) {
      throw new ErreurMetier("Choisis une image.");
    }
    await enregistrerAvatar(membreId, new Uint8Array(await fichier.arrayBuffer()));
    rafraichirTout();
  });
}

export async function actionRetirerAvatar(): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await retirerAvatar(membreId);
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
    const fichier = donnees.get("media");
    if (!(fichier instanceof File) || fichier.size === 0) {
      throw new ErreurMetier("Choisis une image ou une vidéo.");
    }
    const vignette = donnees.get("vignette");

    await ajouterMedia(membreId, jourDeLaBande(), {
      genre: texte(donnees, "genre") === "video" ? "video" : "photo",
      mime: fichier.type,
      // `new Uint8Array(ArrayBuffer)` et pas le tableau du `Buffer` de Node :
      // Prisma veut un `Uint8Array<ArrayBuffer>` pour un champ `Bytes`.
      octets: new Uint8Array(await fichier.arrayBuffer()),
      largeur: Number(texte(donnees, "largeur")) || 0,
      hauteur: Number(texte(donnees, "hauteur")) || 0,
      duree: nombreFacultatif(donnees, "duree"),
      vignette:
        vignette instanceof File && vignette.size > 0
          ? new Uint8Array(await vignette.arrayBuffer())
          : null,
      legende: texte(donnees, "legende"),
    });
    rafraichirTout();
  });
}

/** Une légende s'ajoute et se corrige après coup, comme une note. */
export async function actionLegender(mediaId: string, legende: string): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await legender(membreId, mediaId, legende);
    rafraichirTout();
  });
}

// ── Note vocale ─────────────────────────────────────────────────────────────

export async function actionEnvoyerAudio(_precedent: Etat, donnees: FormData): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    const fichier = donnees.get("audio");
    if (!(fichier instanceof File) || fichier.size === 0) {
      throw new ErreurMetier("L'enregistrement est vide.");
    }

    // Les niveaux servent à dessiner l'onde : ils sont calculés pendant
    // l'enregistrement, parce que les relire depuis les octets côté serveur
    // demanderait de décoder l'audio, donc une dépendance native.
    const niveaux = texte(donnees, "niveaux")
      .split(",")
      .map(Number)
      .filter((n) => Number.isFinite(n));

    await enregistrerAudio(membreId, jourDeLaBande(), {
      mime: fichier.type,
      octets: new Uint8Array(await fichier.arrayBuffer()),
      duree: Number(texte(donnees, "duree")) || 0,
      niveaux,
    });
    rafraichirTout();
  });
}

export async function actionRetirerAudio(): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await retirerAudio(membreId, jourDeLaBande());
    rafraichirTout();
  });
}

/**
 * Poser sa journée sans JavaScript.
 *
 * C'est la cible du `action` du formulaire, et elle n'a l'air de rien : sans
 * une vraie action serveur à cet endroit, React rend
 * `action="javascript:throw ..."` et le formulaire lève au lieu de s'envoyer.
 * Le chemin avec JavaScript, lui, intercepte la soumission pour pouvoir garder
 * la journée sur l'appareil quand le réseau manque.
 *
 * Elle prend la `FormData` seule — une action passée à `action=` ne reçoit pas
 * d'état précédent — et redirige, parce qu'une soumission sans JavaScript
 * attend une réponse de navigation.
 */
export async function actionPoserJourneeSimple(donnees: FormData): Promise<void> {
  await actionPoserJournee(ETAT_INITIAL, donnees);
  // Vers le fil : c'est là que la révélation se voit.
  redirect("/");
}

/**
 * Les variantes « sans JavaScript » des formulaires.
 *
 * Une action passée à `action=` reçoit la `FormData` seule et doit rediriger :
 * une soumission classique attend une navigation. Elles existent surtout pour
 * que React rende un vrai formulaire — sans elles, il rend
 * `action="javascript:throw ..."`, et le formulaire lève au lieu de partir dès
 * que le JavaScript n'a pas chargé.
 */
export async function actionRenommerBandeSimple(donnees: FormData): Promise<void> {
  await actionRenommerBande(ETAT_INITIAL, donnees);
  redirect("/reglages");
}

export async function actionAjouterDeclencheurSimple(donnees: FormData): Promise<void> {
  await actionAjouterDeclencheur(ETAT_INITIAL, donnees);
  redirect("/reglages");
}

export async function actionCommenterSimple(donnees: FormData): Promise<void> {
  await actionCommenter(ETAT_INITIAL, donnees);
  redirect("/");
}

export async function actionQuitterLaBandeSimple(donnees: FormData): Promise<void> {
  // Sans JavaScript, on ne peut pas afficher l'erreur dans la carte : un nom mal
  // recopié ramène simplement à l'écran des réglages, où rien n'a changé.
  await actionQuitterLaBande(ETAT_INITIAL, donnees);
  redirect("/reglages");
}

export async function actionEcrireCapsuleSimple(donnees: FormData): Promise<void> {
  await actionEcrireCapsule(ETAT_INITIAL, donnees);
  redirect("/souvenirs");
}

/** Un média précis, maintenant qu'une journée peut en porter plusieurs. */
export async function actionRetirerPhoto(mediaId: string): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await retirerMedia(membreId, mediaId);
    rafraichirTout();
  });
}

// ── Capsules temporelles ────────────────────────────────────────────────────

export async function actionEcrireCapsule(_precedent: Etat, donnees: FormData): Promise<Etat> {
  return tenter(async () => {
    const { membreId, contexte } = await quiAgit();

    // Le contenu est facultatif : un scellé « mot » n'en a pas. Quand il y en
    // a un, l'aperçu est déjà flouté — le navigateur l'a réduit à trente-deux
    // pixels avant l'envoi.
    const fichier = donnees.get("contenu");
    const apercu = donnees.get("apercu");
    const genre = texte(donnees, "genre");
    const contenu =
      fichier instanceof File && fichier.size > 0 && genre !== "mot"
        ? {
            genre: (genre === "video" || genre === "audio" ? genre : "photo") as
              | "photo"
              | "video"
              | "audio",
            octets: new Uint8Array(await fichier.arrayBuffer()),
            mime: fichier.type,
            apercu:
              apercu instanceof File && apercu.size > 0
                ? new Uint8Array(await apercu.arrayBuffer())
                : new Uint8Array(0),
            duree: nombreFacultatif(donnees, "duree"),
          }
        : undefined;

    await ecrireCapsule(
      membreId,
      contexte.groupe.id,
      texte(donnees, "texte"),
      texte(donnees, "ouvrirLe"),
      jourDeLaBande(),
      contenu,
    );
    rafraichirTout();
  });
}

export async function actionSupprimerCapsule(capsuleId: string): Promise<Etat> {
  return tenter(async () => {
    const { membreId } = await quiAgit();
    await supprimerCapsule(membreId, capsuleId);
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

/**
 * Poser un pouls : deux curseurs, deux taps, aucun texte.
 *
 * Il ne rafraîchit que l'accueil et le check-in — un pouls ne change ni les
 * souvenirs, ni le profil, et il ne rapporte aucun point (voir le schéma).
 */
export async function actionPoserPouls(rire: number, energie: number): Promise<Etat> {
  return tenter(async () => {
    const { membreId, contexte } = await quiAgit();
    await poserPouls(membreId, contexte.groupe.id, jourDeLaBande(), { rire, energie });
    revalidatePath("/aujourdhui");
    revalidatePath("/");
  });
}
