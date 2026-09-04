"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Le temps réel, par sondage.
 *
 * Une empreinte de l'état de la bande est demandée régulièrement ; quand elle
 * change, on demande à Next de refaire le rendu. C'est moins élégant qu'une
 * connexion permanente, et nettement plus robuste : rien à reconnecter après
 * une mise en veille, rien à maintenir côté serveur, et une fonction sans état
 * peut la servir.
 *
 * Deux précautions comptent autant que le sondage lui-même :
 *
 * · on ne sonde pas un onglet caché. Un téléphone dans une poche n'a aucune
 *   raison d'interroger la base toutes les trois secondes ;
 * · au retour de veille, on sonde immédiatement plutôt que d'attendre le
 *   prochain tour — c'est le moment exact où l'on veut voir ce qu'on a raté.
 */
const CADENCE_MS = 3000;

export function Synchronisation({ version }: { version: string }) {
  const router = useRouter();
  const connue = useRef(version);
  const [horsLigne, setHorsLigne] = useState(false);

  // La version rendue par le serveur fait foi : sans cette remise à niveau, un
  // rafraîchissement déclenché par nous relancerait le suivant en boucle. Elle
  // passe par un effet, pas par le rendu : écrire dans une référence pendant le
  // rendu casse le rendu concurrent.
  useEffect(() => {
    connue.current = version;
  }, [version]);

  useEffect(() => {
    let vivant = true;
    let minuteur: ReturnType<typeof setTimeout>;

    async function sonder() {
      if (!vivant) return;
      if (document.visibilityState === "visible") {
        try {
          const reponse = await fetch("/api/version", { cache: "no-store" });
          if (reponse.ok) {
            const { version: fraiche } = (await reponse.json()) as { version: string };
            setHorsLigne(false);
            if (fraiche !== connue.current) {
              connue.current = fraiche;
              router.refresh();
            }
          }
        } catch {
          // Réseau coupé : on le signale et on continue d'essayer. Ce n'est pas
          // une erreur, c'est un tunnel.
          setHorsLigne(true);
        }
      }
      minuteur = setTimeout(sonder, CADENCE_MS);
    }

    const auReveil = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(minuteur);
        sonder();
      }
    };

    minuteur = setTimeout(sonder, CADENCE_MS);
    document.addEventListener("visibilitychange", auReveil);
    window.addEventListener("online", auReveil);

    return () => {
      vivant = false;
      clearTimeout(minuteur);
      document.removeEventListener("visibilitychange", auReveil);
      window.removeEventListener("online", auReveil);
    };
  }, [router]);

  if (!horsLigne) return null;

  return (
    <p
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-encre px-4 py-1.5 text-center text-[12px] font-medium"
      style={{ color: "var(--surface)" }}
    >
      Hors ligne — les journées des autres n&apos;arrivent plus
    </p>
  );
}
