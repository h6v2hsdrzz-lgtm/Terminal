import type { MetadataRoute } from "next";

/**
 * Manifeste d'installation. Next le sert sur /manifest.webmanifest et le
 * référence tout seul dans la page — le journal partagé s'installe donc sur
 * un écran d'accueil comme la version autonome, à ceci près qu'il montre à
 * tout le monde les mêmes données.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Journal de joie",
    short_name: "Joie",
    description:
      "Journal de joie partagé : niveaux quotidiens, déclencheurs et tableau de bord, synchronisés entre tous les appareils.",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f3ed",
    theme_color: "#f5f3ed",
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icone-masquable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
