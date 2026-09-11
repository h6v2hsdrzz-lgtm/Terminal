"use client";

import { useEffect, useState } from "react";

import { BATTEMENT_MS, decalageHorloge } from "@/lib/jeux/salon";
import type { EtatPartie } from "@/lib/jeux/types";

/**
 * L'état d'une partie, tenu à jour par le flux.
 *
 * Trois choses, et elles vont ensemble :
 *
 * · **l'état** vient du serveur, jamais du téléphone. On l'affiche, on ne le
 *   déduit pas ;
 * · **le battement** part toutes les cinq secondes pour dire « je suis là ».
 *   Sans lui, un téléphone verrouillé passe pour parti — ce qui est d'ailleurs
 *   le comportement voulu au bout de vingt secondes ;
 * · **le décalage d'horloge** est mesuré à chaque état reçu. C'est lui qui
 *   permet à un compte à rebours d'être local, donc sans latence, tout en
 *   restant le même pour les trois téléphones.
 *
 * `EventSource` se reconnecte seul, y compris au retour de veille : c'est la
 * raison principale de l'avoir choisi plutôt qu'un WebSocket, qu'il aurait
 * fallu rouvrir à la main à chaque déverrouillage d'iPhone.
 */
export type FluxPartie = {
  etat: EtatPartie | null;
  /** Vrai tant que le premier état n'est pas arrivé. */
  chargement: boolean;
  /** Le flux est-il ouvert ? Sert à afficher « reconnexion… ». */
  relie: boolean;
  /** Décalage en millisecondes entre l'horloge du serveur et celle d'ici. */
  decalage: number;
};

export function useFluxPartie(partieId: string, initial: EtatPartie | null): FluxPartie {
  const [etat, setEtat] = useState<EtatPartie | null>(initial);
  const [relie, setRelie] = useState(false);
  const [decalage, setDecalage] = useState(0);

  useEffect(() => {
    const source = new EventSource(`/api/partie/${partieId}/flux`);

    source.addEventListener("open", () => setRelie(true));
    source.addEventListener("error", () => setRelie(false));

    source.addEventListener("etat", (evenement) => {
      const recu = JSON.parse((evenement as MessageEvent).data) as EtatPartie;
      // Mesuré à chaque état plutôt qu'une fois : l'horloge d'un téléphone
      // dérive, et une partie dure vingt minutes. On ne le réécrit que s'il a
      // bougé d'un quart de seconde — sinon chaque événement provoquerait un
      // rendu de plus pour un écart que personne ne perçoit.
      const mesure = decalageHorloge(recu.maintenant);
      setDecalage((avant) => (Math.abs(mesure - avant) > 250 ? mesure : avant));
      setRelie(true);
      setEtat(recu);
    });

    source.addEventListener("disparue", () => {
      setEtat(null);
      source.close();
    });

    return () => source.close();
  }, [partieId]);

  // Le battement de présence. Il ne passe pas par le flux : un flux est
  // descendant, et ouvrir une requête montante toutes les cinq secondes coûte
  // moins cher que de maintenir un canal dans les deux sens.
  useEffect(() => {
    const battre = () => {
      void fetch(`/api/partie/${partieId}/present`, { method: "POST", keepalive: true }).catch(
        () => {
          // Un battement perdu n'est pas un problème : le suivant arrive dans
          // cinq secondes, et l'absence ne se déclare qu'au bout de vingt.
        },
      );
    };
    battre();
    const minuteur = setInterval(battre, BATTEMENT_MS);
    return () => clearInterval(minuteur);
  }, [partieId]);

  return { etat, chargement: etat === null, relie, decalage };
}
