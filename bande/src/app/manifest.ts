import type { MetadataRoute } from "next";

/**
 * Le manifeste, pour que l'application s'installe sur l'écran d'accueil.
 *
 * `display: standalone` retire la barre d'adresse : une fois posée sur
 * l'écran d'accueil, elle ressemble à une application et non à un onglet.
 * L'icône masquable est fournie à part parce qu'Android recadre jusqu'à 20 %
 * de chaque côté — un dessin calibré pour l'icône ordinaire s'y ferait rogner
 * les joues.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Journal de joie",
    short_name: "Joie",
    description: "Le repaire de la bande : une joie par jour, et ce qu'on en tire.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "fr",
    dir: "ltr",
    background_color: "#fbfaf8",
    theme_color: "#fbfaf8",
    categories: ["lifestyle", "social"],
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icone-masquable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
