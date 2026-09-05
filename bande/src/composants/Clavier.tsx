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

    mesurer();
    vue.addEventListener("resize", mesurer);
    vue.addEventListener("scroll", mesurer);
    return () => {
      vue.removeEventListener("resize", mesurer);
      vue.removeEventListener("scroll", mesurer);
      document.documentElement.classList.remove("clavier-ouvert");
    };
  }, []);

  return null;
}
