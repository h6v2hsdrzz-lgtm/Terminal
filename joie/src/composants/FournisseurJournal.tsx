"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { chargerEntrees, chargerVersion, creerEntree, effacerEntree, majEntree } from "@/lib/api";
import type { Entree, SaisieEntree } from "@/lib/types";

/**
 * État partagé du journal. Les données arrivent déjà chargées du serveur ;
 * ce fournisseur ne gère que leurs modifications et les messages de retour.
 */

export type Message = { id: number; texte: string; ton: "succes" | "erreur" };

/**
 * Cadence d'interrogation. Trois secondes : assez court pour qu'une saisie
 * faite sur un autre appareil arrive pendant qu'on regarde l'écran, assez
 * long pour ne pas peser sur une base gratuite. La page ne demande que
 * l'empreinte du journal ; elle ne recharge les entrées que si elle a bougé.
 */
const CADENCE_MS = 3000;

type Journal = {
  entrees: Entree[];
  enregistrer: (saisie: SaisieEntree) => Promise<Entree>;
  modifier: (id: string, saisie: SaisieEntree) => Promise<Entree>;
  supprimer: (entree: Entree) => Promise<void>;
  messages: Message[];
  signaler: (texte: string, ton?: Message["ton"]) => void;
  fermerMessage: (id: number) => void;
  /** Vrai tant que la page n'a pas réussi à joindre le serveur. */
  horsLigne: boolean;
};

const ContexteJournal = createContext<Journal | null>(null);

function trier(entrees: Entree[]): Entree[] {
  return [...entrees].sort(
    (a, b) => b.date.localeCompare(a.date) || a.personne.localeCompare(b.personne),
  );
}

export function FournisseurJournal({
  entreesInitiales,
  versionInitiale,
  children,
}: {
  entreesInitiales: Entree[];
  versionInitiale: string;
  children: ReactNode;
}) {
  const [entrees, setEntrees] = useState<Entree[]>(() => trier(entreesInitiales));
  const [messages, setMessages] = useState<Message[]>([]);
  const [horsLigne, setHorsLigne] = useState(false);
  const version = useRef(versionInitiale);

  const signaler = useCallback((texte: string, ton: Message["ton"] = "succes") => {
    const id = Date.now() + Math.random();
    setMessages((actuels) => [...actuels, { id, texte, ton }]);
    setTimeout(() => setMessages((actuels) => actuels.filter((m) => m.id !== id)), 4000);
  }, []);

  const fermerMessage = useCallback((id: number) => {
    setMessages((actuels) => actuels.filter((m) => m.id !== id));
  }, []);

  /**
   * Retient l'empreinte que le serveur vient d'atteindre, pour que nos
   * propres écritures ne déclenchent pas un rechargement inutile.
   */
  const noterVersion = useCallback(async () => {
    try {
      version.current = await chargerVersion();
    } catch {
      // Sans empreinte, la boucle rechargera une fois de trop. Sans plus.
    }
  }, []);

  const enregistrer = useCallback(
    async (saisie: SaisieEntree) => {
      const entree = await creerEntree(saisie);
      setEntrees((actuelles) =>
        trier([...actuelles.filter((e) => e.id !== entree.id), entree]),
      );
      void noterVersion();
      return entree;
    },
    [noterVersion],
  );

  const modifier = useCallback(async (id: string, saisie: SaisieEntree) => {
    const entree = await majEntree(id, saisie);
    setEntrees((actuelles) => trier(actuelles.map((e) => (e.id === id ? entree : e))));
    void noterVersion();
    return entree;
  }, [noterVersion]);

  const supprimer = useCallback(
    async (entree: Entree) => {
      // Retrait optimiste : la ligne disparaît tout de suite, et revient si le
      // serveur refuse.
      setEntrees((actuelles) => actuelles.filter((e) => e.id !== entree.id));
      try {
        await effacerEntree(entree.id);
        void noterVersion();
      } catch (erreur) {
        setEntrees((actuelles) => trier([...actuelles, entree]));
        throw erreur;
      }
    },
    [noterVersion],
  );

  /**
   * Boucle de synchronisation. Elle ne tourne que sur un onglet visible :
   * un téléphone dans une poche n'a rien à demander, et l'onglet se remet à
   * jour dès qu'on y revient.
   */
  useEffect(() => {
    let vivant = true;
    let minuterie: ReturnType<typeof setTimeout> | undefined;

    async function verifier() {
      if (!vivant || document.visibilityState !== "visible") return;
      try {
        const derniere = await chargerVersion();
        setHorsLigne(false);
        if (vivant && derniere !== version.current) {
          const { entrees: fraiches, version: atteinte } = await chargerEntrees();
          if (!vivant) return;
          version.current = atteinte || derniere;
          setEntrees(trier(fraiches));
          signaler("Journal mis à jour depuis un autre appareil.");
        }
      } catch {
        // Le serveur ne répond pas : on le signale et on réessaie au tour
        // suivant, sans vider ce qui est affiché.
        if (vivant) setHorsLigne(true);
      }
    }

    function boucler() {
      minuterie = setTimeout(async () => {
        await verifier();
        if (vivant) boucler();
      }, CADENCE_MS);
    }

    function surRetour() {
      if (document.visibilityState === "visible") void verifier();
    }

    boucler();
    document.addEventListener("visibilitychange", surRetour);
    window.addEventListener("focus", surRetour);

    return () => {
      vivant = false;
      clearTimeout(minuterie);
      document.removeEventListener("visibilitychange", surRetour);
      window.removeEventListener("focus", surRetour);
    };
  }, [signaler]);

  const valeur = useMemo<Journal>(
    () => ({ entrees, enregistrer, modifier, supprimer, messages, signaler, fermerMessage, horsLigne }),
    [entrees, enregistrer, modifier, supprimer, messages, signaler, fermerMessage, horsLigne],
  );

  return <ContexteJournal.Provider value={valeur}>{children}</ContexteJournal.Provider>;
}

export function useJournal(): Journal {
  const journal = useContext(ContexteJournal);
  if (!journal) throw new Error("useJournal doit être utilisé dans <FournisseurJournal>.");
  return journal;
}
