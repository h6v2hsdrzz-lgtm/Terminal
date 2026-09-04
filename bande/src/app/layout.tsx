import type { Metadata, Viewport } from "next";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
