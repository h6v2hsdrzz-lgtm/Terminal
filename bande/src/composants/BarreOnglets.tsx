"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

import { RESSORT } from "@/lib/mouvement";

/**
 * La navigation principale, sous deux formes.
 *
 * Sur téléphone, une barre en bas : c'est là que le pouce arrive. Sur grand
 * écran, un rail à gauche — une barre d'onglets en bas d'un écran de 1440
 * pixels est une barre qu'on ne regarde jamais, et la colonne de contenu
 * flottait au milieu d'un désert.
 *
 * Dans les deux cas, l'onglet actif est signalé par une pastille qui se déplace
 * d'un onglet à l'autre plutôt que d'apparaître et disparaître : le mouvement
 * dit d'où l'on vient. Les deux formes ont leur propre `layoutId`, sinon la
 * pastille traverserait l'écran en diagonale au changement de taille.
 */
const ONGLETS = [
  // Le fil d'abord : c'est ce qu'on ouvre le matin, et c'est la racine.
  { href: "/", nom: "Fil", icone: FilIcone },
  { href: "/aujourdhui", nom: "Aujourd'hui", icone: SoleilIcone },
  { href: "/jeux", nom: "Jeux", icone: JeuxIcone },
  { href: "/souvenirs", nom: "Souvenirs", icone: SouvenirsIcone },
  { href: "/profil", nom: "Profil", icone: ProfilIcone },
];

export function BarreOnglets() {
  const chemin = usePathname();

  return (
    <>
      {/* Téléphone : la barre du bas. */}
      <nav
        aria-label="Navigation principale"
        className="barre-onglets fixed inset-x-0 bottom-0 z-40 border-t border-trait bg-[var(--voile)] backdrop-blur-xl zone-sure-basse lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch">
          {ONGLETS.map((onglet) => {
            const actif = chemin === onglet.href;
            const Icone = onglet.icone;
            return (
              <li key={onglet.href} className="flex-1">
                <Link
                  href={onglet.href}
                  aria-current={actif ? "page" : undefined}
                  className="cible-tactile relative flex min-h-[52px] flex-col items-center justify-center gap-1 px-2 pt-2.5 pb-2"
                >
                  {actif && (
                    <motion.span
                      layoutId="onglet-actif-bas"
                      transition={RESSORT.vif}
                      className="absolute inset-x-3 top-1 h-9 rounded-[var(--radius-pilule)] bg-surface-2"
                    />
                  )}
                  <span className={`relative ${actif ? "text-encre" : "text-encre-3"}`}>
                    <Icone actif={actif} />
                  </span>
                  <span
                    className={`relative text-[11px] font-medium tracking-tight ${
                      actif ? "text-encre" : "text-encre-3"
                    }`}
                  >
                    {onglet.nom}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Grand écran : le rail de gauche. */}
      <nav
        aria-label="Navigation principale"
        className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-trait bg-surface px-3 py-6 zone-sure-haute zone-sure-basse lg:flex"
      >
        <p className="mb-6 px-3 text-[15px] font-semibold tracking-tight">Journal de joie</p>
        <ul className="space-y-1">
          {ONGLETS.map((onglet) => {
            const actif = chemin === onglet.href;
            const Icone = onglet.icone;
            return (
              <li key={onglet.href}>
                <Link
                  href={onglet.href}
                  aria-current={actif ? "page" : undefined}
                  className="relative flex items-center gap-3 rounded-[var(--radius-pilule)] px-3 py-2.5"
                >
                  {actif && (
                    <motion.span
                      layoutId="onglet-actif-rail"
                      transition={RESSORT.vif}
                      className="absolute inset-0 rounded-[var(--radius-pilule)] bg-surface-2"
                    />
                  )}
                  <span className={`relative ${actif ? "text-encre" : "text-encre-3"}`}>
                    <Icone actif={actif} />
                  </span>
                  <span
                    className={`relative text-[15px] font-medium tracking-tight ${
                      actif ? "text-encre" : "text-encre-2"
                    }`}
                  >
                    {onglet.nom}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

/* Icônes dessinées ici plutôt qu'importées d'une bibliothèque : cinq tracés
   ne justifient pas une dépendance, et ils partagent ainsi exactement la même
   graisse que la typographie. */

type PropsIcone = { actif: boolean };

function base(actif: boolean) {
  return {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: actif ? 2.1 : 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

function SoleilIcone({ actif }: PropsIcone) {
  return (
    <svg {...base(actif)} aria-hidden>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21M5.6 5.6l1.2 1.2M17.2 17.2l1.2 1.2M18.4 5.6l-1.2 1.2M6.8 17.2l-1.2 1.2" />
    </svg>
  );
}

function FilIcone({ actif }: PropsIcone) {
  return (
    <svg {...base(actif)} aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="6" rx="2.2" />
      <rect x="3.5" y="13.5" width="17" height="6" rx="2.2" />
    </svg>
  );
}

function SouvenirsIcone({ actif }: PropsIcone) {
  return (
    <svg {...base(actif)} aria-hidden>
      <rect x="3.5" y="5" width="17" height="14" rx="2.4" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4.5 17l4.2-4 3 2.6 3.4-3.6 4.4 4.4" />
    </svg>
  );
}

function JeuxIcone({ actif }: PropsIcone) {
  // Un dé : le seul objet qui dit « jeu » sans dire quel jeu.
  return (
    <svg {...base(actif)} aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="8.6" cy="8.6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.4" cy="15.4" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ProfilIcone({ actif }: PropsIcone) {
  return (
    <svg {...base(actif)} aria-hidden>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.8 20c1.1-3.6 3.9-5.4 7.2-5.4s6.1 1.8 7.2 5.4" />
    </svg>
  );
}
