import type { Metadata, Viewport } from "next";

import { BarreOnglets } from "@/composants/BarreOnglets";
import "./globals.css";

export const metadata: Metadata = {
  title: "Journal de joie",
  description: "Le repaire de la bande : une joie par jour, et ce qu'on en tire.",
  appleWebApp: { capable: true, title: "Joie", statusBarStyle: "black-translucent" },
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
        <div className="mx-auto min-h-dvh w-full max-w-lg marge-basse">{children}</div>
        <BarreOnglets />
      </body>
    </html>
  );
}
