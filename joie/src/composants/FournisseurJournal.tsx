"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { creerEntree, effacerEntree, majEntree } from "@/lib/api";
import type { Entree, SaisieEntree } from "@/lib/types";

/**
 * État partagé du journal. Les données arrivent déjà chargées du serveur ;
 * ce fournisseur ne gère que leurs modifications et les messages de retour.
 */

export type Message = { id: number; texte: string; ton: "succes" | "erreur" };

type Journal = {
  entrees: Entree[];
  enregistrer: (saisie: SaisieEntree) => Promise<Entree>;
  modifier: (id: string, saisie: SaisieEntree) => Promise<Entree>;
  supprimer: (entree: Entree) => Promise<void>;
  messages: Message[];
  signaler: (texte: string, ton?: Message["ton"]) => void;
  fermerMessage: (id: number) => void;
};

const ContexteJournal = createContext<Journal | null>(null);

function trier(entrees: Entree[]): Entree[] {
  return [...entrees].sort(
    (a, b) => b.date.localeCompare(a.date) || a.personne.localeCompare(b.personne),
  );
}

export function FournisseurJournal({
  entreesInitiales,
  children,
}: {
  entreesInitiales: Entree[];
  children: ReactNode;
}) {
  const [entrees, setEntrees] = useState<Entree[]>(() => trier(entreesInitiales));
  const [messages, setMessages] = useState<Message[]>([]);

  const signaler = useCallback((texte: string, ton: Message["ton"] = "succes") => {
    const id = Date.now() + Math.random();
    setMessages((actuels) => [...actuels, { id, texte, ton }]);
    setTimeout(() => setMessages((actuels) => actuels.filter((m) => m.id !== id)), 4000);
  }, []);

  const fermerMessage = useCallback((id: number) => {
    setMessages((actuels) => actuels.filter((m) => m.id !== id));
  }, []);

  const enregistrer = useCallback(
    async (saisie: SaisieEntree) => {
      const entree = await creerEntree(saisie);
      setEntrees((actuelles) =>
        trier([...actuelles.filter((e) => e.id !== entree.id), entree]),
      );
      return entree;
    },
    [],
  );

  const modifier = useCallback(async (id: string, saisie: SaisieEntree) => {
    const entree = await majEntree(id, saisie);
    setEntrees((actuelles) => trier(actuelles.map((e) => (e.id === id ? entree : e))));
    return entree;
  }, []);

  const supprimer = useCallback(
    async (entree: Entree) => {
      // Retrait optimiste : la ligne disparaît tout de suite, et revient si le
      // serveur refuse.
      setEntrees((actuelles) => actuelles.filter((e) => e.id !== entree.id));
      try {
        await effacerEntree(entree.id);
      } catch (erreur) {
        setEntrees((actuelles) => trier([...actuelles, entree]));
        throw erreur;
      }
    },
    [],
  );

  const valeur = useMemo<Journal>(
    () => ({ entrees, enregistrer, modifier, supprimer, messages, signaler, fermerMessage }),
    [entrees, enregistrer, modifier, supprimer, messages, signaler, fermerMessage],
  );

  return <ContexteJournal.Provider value={valeur}>{children}</ContexteJournal.Provider>;
}

export function useJournal(): Journal {
  const journal = useContext(ContexteJournal);
  if (!journal) throw new Error("useJournal doit être utilisé dans <FournisseurJournal>.");
  return journal;
}
