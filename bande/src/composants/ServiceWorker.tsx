"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker.
 *
 * Seulement en production : en développement, un service worker qui garde des
 * fichiers en cache fait passer une heure à débugger une modification déjà
 * enregistrée. Et seulement après le chargement, pour ne pas se disputer la
 * bande passante avec l'application elle-même.
 */
export function ServiceWorker() {
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
