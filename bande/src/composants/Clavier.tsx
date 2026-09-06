"use client";

import { useEffect } from "react";

/**
 * Le clavier de l'iPhone, et la barre d'onglets qui passe par-dessus.
 *
 * Sur iOS, l'ouverture du clavier ne change pas `window.innerHeight` : elle
 * rétrécit le *viewport visuel*. Une barre en `position: fixed` reste donc
 * collée en bas de la fenêtre — c'est-à-dire, une fois le clavier ouvert,
 * par-dessus le champ qu'on est en train de remplir.
 *
 * On écoute donc `visualViewport` et on marque le document quand l'écart
 * dépasse le seuil. Le style, lui, vit dans la feuille : ce composant ne fait
 * que dire « le clavier est là ».
 */
const SEUIL = 140;

export function Clavier() {
  useEffect(() => {
    const vue = window.visualViewport;
    if (!vue) return;

    const mesurer = () => {
      // `offsetTop` compte aussi quand la page est décalée par le zoom.
      const cache = window.innerHeight - vue.height - vue.offsetTop;
      document.documentElement.classList.toggle("clavier-ouvert", cache > SEUIL);
    };

    /**
     * Ramener le champ actif au-dessus du clavier.
     *
     * Effacer la barre d'onglets ne suffit pas : un champ situé au bas d'un
     * formulaire long reste sous le clavier, et on tape à l'aveugle. Le
     * navigateur fait parfois ce défilement lui-même, parfois non — sur iOS ça
     * dépend de la hauteur du champ et du moment de la mise au point.
     *
     * Le délai n'est pas décoratif : au moment du `focus`, le clavier n'a pas
     * fini de monter et `visualViewport` rend encore l'ancienne hauteur. On
     * défilerait vers une position qui n'existe plus une fraction de seconde
     * plus tard.
     */
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const suivre = (evenement: FocusEvent) => {
      const cible = evenement.target;
      if (!(cible instanceof HTMLElement)) return;
      if (!cible.matches("input, textarea, select")) return;
      clearTimeout(minuteur);
      minuteur = setTimeout(() => {
        cible.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 320);
    };

    mesurer();
    vue.addEventListener("resize", mesurer);
    vue.addEventListener("scroll", mesurer);
    document.addEventListener("focusin", suivre);
    return () => {
      clearTimeout(minuteur);
      vue.removeEventListener("resize", mesurer);
      vue.removeEventListener("scroll", mesurer);
      document.removeEventListener("focusin", suivre);
      document.documentElement.classList.remove("clavier-ouvert");
    };
  }, []);

  return null;
}
