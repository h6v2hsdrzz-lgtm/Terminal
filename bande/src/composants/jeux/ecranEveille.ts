"use client";

import { useEffect } from "react";

/**
 * Garder l'écran allumé pendant une partie.
 *
 * Un téléphone posé au milieu de la table s'éteint au bout de trente
 * secondes ; il faut alors le déverrouiller à chaque manche, et une partie
 * s'arrête là. `WakeLock` existe sur Safari depuis la 16.4, ce qui couvre les
 * iPhone de la bande.
 *
 * Deux points qui coûtent cher à découvrir soi-même :
 *
 * - **Le verrou est perdu dès que l'onglet passe en arrière-plan**, et il n'est
 *   pas repris tout seul au retour. D'où l'écoute de `visibilitychange` :
 *   sinon, un coup d'œil à un message et l'écran se rendort pour de bon.
 * - **La demande peut échouer** (batterie faible, navigateur sans l'API) et
 *   c'est très bien : elle ne doit rien casser. Le `catch` est vide exprès.
 */
export function useEcranEveille(actif: boolean) {
  useEffect(() => {
    if (!actif || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let verrou: WakeLockSentinel | null = null;
    let vivant = true;

    const demander = async () => {
      try {
        verrou = await navigator.wakeLock.request("screen");
      } catch {
        // Batterie faible, permission refusée, API absente : on joue quand même.
      }
    };

    const auRetour = () => {
      if (document.visibilityState === "visible" && vivant) void demander();
    };

    void demander();
    document.addEventListener("visibilitychange", auRetour);

    return () => {
      vivant = false;
      document.removeEventListener("visibilitychange", auRetour);
      void verrou?.release().catch(() => {});
    };
  }, [actif]);
}
