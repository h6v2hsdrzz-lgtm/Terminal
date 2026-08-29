"use client";

import { Moon, Sun } from "lucide-react";

const CLE = "joie:theme";

/**
 * Bascule clair / sombre. Aucun état React : la classe `dark` posée sur
 * <html> par le script du layout est la seule source de vérité, et les deux
 * icônes sont affichées ou masquées par CSS. Rien à hydrater, donc rien qui
 * clignote au chargement.
 */
export function BasculeTheme() {
  function basculer() {
    const suivant = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", suivant);
    try {
      localStorage.setItem(CLE, suivant ? "sombre" : "clair");
    } catch {
      // Navigation privée : le choix ne survivra pas au rechargement, tant pis.
    }
  }

  return (
    <button
      type="button"
      onClick={basculer}
      aria-label="Changer de thème"
      title="Changer de thème"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-bordure bg-surface text-attenue transition hover:bg-surface-2 hover:text-texte"
    >
      <Moon size={16} className="dark:hidden" />
      <Sun size={16} className="hidden dark:block" />
    </button>
  );
}
