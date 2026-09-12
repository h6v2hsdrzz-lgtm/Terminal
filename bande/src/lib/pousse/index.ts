import "server-only";

import { prisma } from "../db";
import { envoyer } from "./envoi";
import { TYPES, preferences, type Notification, type TypeNotification } from "./types";

export { clePublique, configuree } from "./envoi";
export type { Notification, TypeNotification } from "./types";

/**
 * À qui pousser, et le faire sans casser ce qui se passait.
 *
 * ## La règle du dépôt, et pourquoi elle plie ici
 *
 * `depot.ts` et `depot-jeux.ts` sont normalement les seuls à parler à Prisma.
 * Ce fichier lit deux tables — les abonnements et les préférences — et c'est
 * assumé : la pousse n'est pas un domaine du produit, c'est un tuyau. Le mettre
 * dans `depot.ts` y aurait ajouté cent lignes qui ne parlent ni de journées ni
 * de bande, et l'aurait fait grossir pour rien.
 *
 * ## Rien ne doit jamais échouer à cause d'une notification
 *
 * Personne ne perd son commentaire parce qu'un serveur de pousse a hoqueté :
 * `prevenir` n'attend pas, ne lève pas, et ne rend rien. Ce qu'elle sait faire,
 * c'est retirer un abonnement que le serveur déclare mort — sinon la table
 * enfle de téléphones qu'on a changés il y a deux ans.
 */

export async function enregistrerAbonnement(
  membreId: string,
  abonnement: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await prisma.abonnement.upsert({
    where: { endpoint: abonnement.endpoint },
    // Se réabonner depuis le même appareil REMPLACE : sinon un changement de
    // compte sur le même téléphone laisserait l'ancien recevoir les
    // notifications du nouveau.
    create: { membreId, ...abonnement },
    update: { membreId, p256dh: abonnement.p256dh, auth: abonnement.auth, vuLe: new Date() },
  });
}

export async function oublierAbonnement(endpoint: string): Promise<void> {
  await prisma.abonnement.deleteMany({ where: { endpoint } });
}

/** Les appareils abonnés de quelqu'un. Sert à dire « tu es abonné » ou non. */
export async function abonnementsDe(membreId: string): Promise<number> {
  return prisma.abonnement.count({ where: { membreId } });
}

export async function lirePreferences(membreId: string) {
  const membre = await prisma.membre.findUnique({
    where: { id: membreId },
    select: { notifications: true },
  });
  return preferences(membre?.notifications);
}

/**
 * Changer UN réglage, sans écraser les autres.
 *
 * ## Pourquoi ce n'est pas un `update` ordinaire
 *
 * La première version relisait l'objet, en posait une copie modifiée, et
 * réécrivait le tout. Entre la lecture et l'écriture il y a un aller-retour
 * réseau, et deux cases cochées coup sur coup — ce que fait tout le monde en
 * réglant ses notifications — peuvent s'y croiser : la seconde lit avant que la
 * première ait écrit, et l'écrase.
 *
 * **Ce n'est pas un défaut observé.** Les deux clics d'un test sont trop
 * espacés pour le provoquer, et je n'ai pas réussi à le reproduire. C'est un
 * défaut *lisible dans le code* : une lecture-modification-écriture sur une
 * colonne partagée n'a pas besoin d'être vue pour être fausse, et la corriger
 * coûte une ligne.
 *
 * `||` fusionne deux objets JSONB **du côté de PostgreSQL**, dans la même
 * instruction que la lecture : il n'y a plus d'intervalle entre les deux.
 */
export async function reglerPreference(
  membreId: string,
  type: TypeNotification,
  valeur: boolean,
): Promise<void> {
  // Le type vient d'une liste fermée, mais il finit dans du JSON : on le
  // vérifie ici plutôt que de faire confiance à l'appelant.
  if (!TYPES.includes(type)) throw new Error(`Type de notification inconnu : ${type}`);
  await prisma.$executeRaw`
    UPDATE "bande_membres"
    SET "notifications" = COALESCE("notifications", '{}'::jsonb) || ${JSON.stringify({
      [type]: valeur,
    })}::jsonb
    WHERE "id" = ${membreId}
  `;
}

/**
 * Prévenir des gens, sans jamais faire échouer ce qui se passait.
 *
 * On n'attend pas le résultat : une notification part pendant que l'écran de
 * celui qui a écrit revient au fil. Et on filtre sur les préférences AVANT de
 * chiffrer quoi que ce soit — chiffrer pour jeter serait du travail pour rien.
 */
export function prevenir(membreIds: string[], notification: Notification): void {
  void pousser(membreIds, notification).catch(() => {
    // Une notification perdue ne mérite pas une trace : le geste qui l'a
    // déclenchée, lui, a abouti. C'est ce qui compte.
  });
}

/**
 * La même chose, mais **attendue**.
 *
 * Le réveil du matin (`/api/reveil`) en a besoin : une fonction serverless qui
 * rend sa réponse est gelée, et une notification encore en vol à ce moment-là
 * ne part jamais. Partout ailleurs on ne l'attend pas — le geste qui l'a
 * déclenchée compte plus qu'elle.
 */
export async function prevenirEtAttendre(
  membreIds: string[],
  notification: Notification,
): Promise<void> {
  await pousser(membreIds, notification);
}

async function pousser(membreIds: string[], notification: Notification): Promise<void> {
  if (membreIds.length === 0) return;

  const membres = await prisma.membre.findMany({
    where: { id: { in: membreIds } },
    select: { id: true, notifications: true },
  });
  const veulent = membres
    .filter((m) => preferences(m.notifications)[notification.type])
    .map((m) => m.id);
  if (veulent.length === 0) return;

  const abonnements = await prisma.abonnement.findMany({
    where: { membreId: { in: veulent } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  const issues = await Promise.all(
    abonnements.map(async (a) => ({ id: a.id, issue: await envoyer(a, notification) })),
  );

  const perimes = issues.filter((r) => r.issue === "perimee").map((r) => r.id);
  if (perimes.length > 0) {
    await prisma.abonnement.deleteMany({ where: { id: { in: perimes } } });
  }
  const vivants = issues.filter((r) => r.issue === "envoyee").map((r) => r.id);
  if (vivants.length > 0) {
    await prisma.abonnement.updateMany({
      where: { id: { in: vivants } },
      data: { vuLe: new Date() },
    });
  }
}
