import type { Metadata, Viewport } from "next";

import { Clavier } from "@/composants/Clavier";
import { ServiceWorker } from "@/composants/ServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Journal de joie",
  description: "Le repaire de la bande : une joie par jour, et ce qu'on en tire.",
  appleWebApp: { capable: true, title: "Joie", statusBarStyle: "black-translucent" },
  // iOS ignore le manifeste pour l'icône de l'écran d'accueil et veut la sienne.
  icons: { apple: "/icone-apple-180.png" },
  // Une application privée n'a rien à faire dans un index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0e" },
  ],
  viewportFit: "cover",
};

/**
 * Le thème choisi, posé AVANT le premier rendu.
 *
 * Sans ce script, la page s'affiche dans le thème du système puis bascule quand
 * React se réveille : un éclair blanc à minuit, et l'application est rangée dans
 * les choses qui font mal aux yeux. Il est minuscule et synchrone exprès — c'est
 * la seule façon d'être là avant la peinture.
 */
const THEME = `try{var t=localStorage.getItem("joie-theme");if(t==="clair"||t==="sombre")document.documentElement.classList.add(t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        {children}
        <Clavier />
        <ServiceWorker />
      </body>
    </html>
  );
}
