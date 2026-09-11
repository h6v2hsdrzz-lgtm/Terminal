"use client";

import { useState, useTransition } from "react";

import { Carte, TitreSection } from "./Carte";
import { actionAbonner, actionDesabonner, actionReglerNotification } from "@/lib/actions";
import { LIBELLES, TYPES, type TypeNotification } from "@/lib/pousse/types";

/**
 * Les notifications, par type.
 *
 * ## Deux réglages, pas un
 *
 * **Cet appareil reçoit-il des notifications** est une question d'appareil — on
 * peut vouloir être prévenu sur son téléphone et pas sur l'ordinateur du
 * bureau. **Quels types** est une question de personne : choisir « pas les
 * réactions » ici et les recevoir ailleurs n'aurait aucun sens. Le premier vit
 * dans le navigateur, le second en base.
 *
 * ## Le piège du navigateur
 *
 * `Notification.requestPermission()` doit partir d'un vrai geste : appelée au
 * montage, elle est refusée en silence par Safari. Et une permission refusée ne
 * se redemande PAS — le navigateur ne posera plus la question, quoi qu'on
 * fasse. On le dit plutôt que de laisser un bouton qui ne répond plus.
 */
export function BoiteNotifications({
  clePublique,
  preferences,
  abonnements,
}: {
  /** Vide quand les clés VAPID ne sont pas posées : la boîte le dit alors. */
  clePublique: string;
  preferences: Record<TypeNotification, boolean>;
  abonnements: number;
}) {
  const [etat, setEtat] = useState<"repos" | "travail" | "refuse" | "impossible">("repos");
  const [abonne, setAbonne] = useState(abonnements > 0);
  const [choix, setChoix] = useState(preferences);
  const [enCours, demarrer] = useTransition();

  async function abonner() {
    setEtat("travail");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setEtat("impossible");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setEtat("refuse");
      return;
    }

    try {
      const enregistrement = await navigator.serviceWorker.ready;
      const abonnement = await enregistrement.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: clePublique,
      });
      const brut = abonnement.toJSON() as { keys?: { p256dh?: string; auth?: string } };
      await actionAbonner({
        endpoint: abonnement.endpoint,
        p256dh: brut.keys?.p256dh ?? "",
        auth: brut.keys?.auth ?? "",
      });
      setAbonne(true);
      setEtat("repos");
    } catch {
      setEtat("impossible");
    }
  }

  async function desabonner() {
    setEtat("travail");
    try {
      const enregistrement = await navigator.serviceWorker.ready;
      const abonnement = await enregistrement.pushManager.getSubscription();
      if (abonnement) {
        await actionDesabonner(abonnement.endpoint);
        await abonnement.unsubscribe();
      }
    } catch {
      // L'abonnement local a déjà disparu : la ligne côté serveur partira au
      // premier envoi refusé.
    }
    setAbonne(false);
    setEtat("repos");
  }

  if (clePublique === "") {
    return (
      <section className="mt-7">
        <TitreSection>Les notifications</TitreSection>
        <Carte className="p-4">
          <p className="text-[14px] leading-snug text-encre-2">
            Pas encore branchées sur ce déploiement. Il manque la paire de clés
            VAPID — deux variables à poser, et ce bloc s&apos;allume.
          </p>
        </Carte>
      </section>
    );
  }

  return (
    <section className="mt-7">
      <TitreSection>Les notifications</TitreSection>

      <Carte className="p-4">
        <p className="text-[15px] font-medium">
          {abonne ? "Cet appareil est prévenu." : "Cet appareil ne reçoit rien."}
        </p>
        <p className="mt-1 text-[13px] leading-snug text-encre-3">
          {abonne
            ? "Tu peux couper ici, et régler ce que tu reçois juste en dessous."
            : "Rien ne part tant que tu n'as pas dit oui, et le navigateur le redemandera."}
        </p>

        {etat === "refuse" && (
          <p role="alert" className="mt-3 text-[13px] leading-snug text-encre-2">
            Ton navigateur a dit non, et il ne reposera plus la question tout seul.
            Il faut passer par ses réglages de site pour l&apos;autoriser à nouveau.
          </p>
        )}
        {etat === "impossible" && (
          <p role="alert" className="mt-3 text-[13px] leading-snug text-encre-2">
            Cet appareil ne sait pas recevoir de notifications. Sur iPhone, il faut
            d&apos;abord ajouter l&apos;application à l&apos;écran d&apos;accueil.
          </p>
        )}

        <button
          type="button"
          onClick={() => void (abonne ? desabonner() : abonner())}
          disabled={etat === "travail"}
          style={abonne ? undefined : { background: "var(--encre)", color: "var(--surface)" }}
          className={`cible-tactile mt-3 w-full rounded-[var(--radius-pilule)] px-4 py-3 text-[15px] font-semibold transition disabled:opacity-40 ${
            abonne ? "border border-trait" : ""
          }`}
        >
          {etat === "travail" ? "Un instant…" : abonne ? "Couper sur cet appareil" : "Me prévenir"}
        </button>
      </Carte>

      <Carte className="mt-2.5 divide-y divide-trait">
        {TYPES.map((type) => (
          <label
            key={type}
            className="flex cursor-pointer items-start justify-between gap-3 px-4 py-3.5"
          >
            <span className="min-w-0">
              <span className="block text-[15px]">{LIBELLES[type].titre}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-encre-3">
                {LIBELLES[type].detail}
              </span>
            </span>
            <input
              type="checkbox"
              checked={choix[type]}
              disabled={enCours}
              onChange={(evenement) => {
                const valeur = evenement.target.checked;
                setChoix((avant) => ({ ...avant, [type]: valeur }));
                demarrer(async () => {
                  const reponse = await actionReglerNotification(type, valeur);
                  // On remet comme avant si le serveur a refusé : une case qui
                  // reste cochée sur un réglage qui n'a pas pris, c'est pire
                  // que pas de réglage du tout.
                  if (reponse.erreur) setChoix((avant) => ({ ...avant, [type]: !valeur }));
                });
              }}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--encre)]"
            />
          </label>
        ))}
      </Carte>
    </section>
  );
}
