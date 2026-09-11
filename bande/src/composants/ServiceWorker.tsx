"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Enregistre le service worker.
 *
 * Seulement en production : en développement, un service worker qui garde des
 * fichiers en cache fait passer une heure à débugger une modification déjà
 * enregistrée. Et seulement après le chargement, pour ne pas se disputer la
 * bande passante avec l'application elle-même.
 *
 * Il écoute aussi le service worker : quand on touche une notification et que
 * l'application est déjà ouverte, il n'y a pas de navigation — le service
 * worker envoie un message, et c'est ici qu'on va à l'endroit demandé. Sans ça,
 * toucher une notification remet simplement la fenêtre au premier plan, sur
 * l'écran où on l'avait laissée.
 */
export function ServiceWorker() {
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const aller = (evenement: MessageEvent) => {
      const message = evenement.data as { type?: string; vers?: string } | null;
      if (message?.type !== "aller" || typeof message.vers !== "string") return;
      // Un chemin, jamais une adresse complète : un message venu d'ailleurs ne
      // doit pas pouvoir envoyer la bande sur un autre site.
      if (!message.vers.startsWith("/")) return;
      router.push(message.vers);
    };

    navigator.serviceWorker.addEventListener("message", aller);
    return () => navigator.serviceWorker.removeEventListener("message", aller);
  }, [router]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const enregistrer = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Refusé (navigation privée, réglage du navigateur) : l'application
        // marche sans, elle est juste moins docile hors ligne.
      });
    };

    if (document.readyState === "complete") enregistrer();
    else window.addEventListener("load", enregistrer, { once: true });
  }, []);

  return null;
}
