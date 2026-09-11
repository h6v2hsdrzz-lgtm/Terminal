import "server-only";

import { chiffrer, type Abonne } from "./chiffrement";
import { clesAccordees, enteteAutorisation } from "./vapid";
import type { Notification } from "./types";

/**
 * Envoyer une notification, et savoir quand l'abonnement est mort.
 *
 * ## Ce que rend cette couche
 *
 * Trois issues, et il faut les distinguer : **envoyé**, **abonnement périmé**
 * (le navigateur a renouvelé son adresse, ou l'application a été désinstallée —
 * la ligne doit partir), et **raté** (le serveur de pousse a hoqueté, on
 * réessaiera la prochaine fois). Confondre les deux derniers, c'est soit
 * garder pour toujours des abonnements morts, soit supprimer un abonnement
 * valide au premier incident réseau.
 *
 * ## Rien n'est cassé sans clés
 *
 * Tant que `VAPID_PUBLIQUE` et `VAPID_PRIVEE` ne sont pas posées, `configuree()`
 * rend faux et personne n'envoie rien. C'est la même règle que pour R2 au lot M :
 * une fonctionnalité qui attend sa configuration ne doit pas empêcher le reste
 * de tourner.
 */

export type Issue = "envoyee" | "perimee" | "ratee";

export function configuree(): boolean {
  const privee = process.env.VAPID_PRIVEE;
  const publique = process.env.VAPID_PUBLIQUE;
  return Boolean(privee && publique && clesAccordees(privee, publique));
}

/** La clé publique, pour que le navigateur s'abonne. Vide si rien n'est posé. */
export function clePublique(): string {
  return configuree() ? (process.env.VAPID_PUBLIQUE ?? "") : "";
}

/**
 * Le contact VAPID.
 *
 * Un opérateur de service de pousse doit pouvoir joindre quelqu'un si nos envois
 * posent problème. Certains refusent un jeton sans `sub` — d'où le repli sur
 * l'adresse du déploiement plutôt que sur une chaîne vide.
 */
function contact(): string {
  return (
    process.env.VAPID_CONTACT ??
    `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "journal-de-joie-v2.vercel.app"}`
  );
}

export async function envoyer(
  abonnement: Abonne & { endpoint: string },
  notification: Notification,
): Promise<Issue> {
  if (!configuree()) return "ratee";

  const corps = chiffrer(JSON.stringify(notification), abonnement);
  const autorisation = enteteAutorisation(
    abonnement.endpoint,
    contact(),
    process.env.VAPID_PRIVEE ?? "",
    process.env.VAPID_PUBLIQUE ?? "",
  );

  try {
    const reponse = await fetch(abonnement.endpoint, {
      method: "POST",
      headers: {
        Authorization: autorisation,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        // Quatre semaines : une notification qui arrive un mois plus tard ne
        // sert à personne, mais un téléphone éteint deux jours doit la recevoir.
        TTL: String(60 * 60 * 24 * 28),
        Urgency: "normal",
      },
      body: new Uint8Array(corps),
    });

    // 404 et 410 sont les deux façons dont un serveur de pousse dit « cette
    // adresse n'existe plus ». Tout le reste est un incident, pas un adieu.
    if (reponse.status === 404 || reponse.status === 410) return "perimee";
    return reponse.ok ? "envoyee" : "ratee";
  } catch {
    return "ratee";
  }
}
