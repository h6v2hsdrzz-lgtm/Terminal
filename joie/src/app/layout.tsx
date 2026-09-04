import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Journal de joie — Momo, Sam & Samy",
  description:
    "Suivi quotidien du niveau de joie de Momo, Sam et Samy, et mesure de l'effet des déclencheurs Biberon et Plante verte.",
  // iOS ignore le manifeste : ce sont ces deux-là qui font qu'une icône
  // posée sur l'écran d'accueil s'ouvre en plein écran plutôt que dans Safari.
  appleWebApp: { capable: true, title: "Joie", statusBarStyle: "default" },
  icons: { icon: "/icone-192.png", apple: "/icone-apple-180.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3ed" },
    { media: "(prefers-color-scheme: dark)", color: "#10151d" },
  ],
};

/**
 * Le thème est appliqué avant la peinture par ce script : sans lui, une page
 * sombre s'ouvrirait en blanc le temps que React s'hydrate.
 */
const SCRIPT_THEME = `
(function () {
  try {
    var choix = localStorage.getItem("joie:theme");
    var sombre = choix ? choix === "sombre"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", sombre);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_THEME }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
