"use client";

import { useState } from "react";

import { EnregistreurVocal, type SonEnregistre } from "@/composants/EnregistreurVocal";
import { actionEnvoyerParole } from "@/lib/actions-jeux";
import type { Jeu } from "@/lib/jeux/catalogue";

import { Avatar } from "../../Avatar";
import type { MoteurMulti } from "./CoquilleMulti";
import { PHASES, reponsesDe } from "./protocole";

/**
 * Les deux jeux qui s'enregistrent.
 *
 * « La théorie du complot » et « Le tribunal des idées » ont la même forme :
 * **un joueur parle, les deux autres écoutent, puis notent**. Ce qui change est
 * la durée, ce qu'on demande, et la façon de noter — tout le reste est commun,
 * et le mettre en double aurait fait deux fois les mêmes bogues de micro.
 *
 * ## Le vrai objet du jeu
 *
 * Ce n'est pas la note. C'est l'enregistrement : on le réécoute le lendemain, et
 * c'est là que la soirée existe encore. D'où le soin apporté à ce que la prise
 * ABOUTISSE — l'audio part au serveur avant que l'action de jeu ne soit envoyée,
 * pour qu'on ne puisse pas se retrouver avec une note sur une parole perdue.
 */
export function EcranParole({ moteur, jeu }: { moteur: MoteurMulti; jeu: Jeu }) {
  const { etat, recette, joueurs, moi, acteur } = moteur;
  const jeSuisLActeur = acteur === moi;
  const nomActeur = joueurs.find((j) => j.membreId === acteur)?.pseudo ?? "quelqu'un";
  const [envoi, setEnvoi] = useState<"repos" | "envoie" | "rate">("repos");

  const revelation = etat.phase === PHASES.revelation;
  const reponses = reponsesDe(etat, revelation ? PHASES.question : (etat.phase ?? ""));
  const maReponse = reponses.find((r) => r.membreId === moi);
  const sienne = reponses.find((r) => r.membreId === acteur);
  const paroleId = typeof sienne?.donnees.parole === "string" ? sienne.donnees.parole : null;
  const secondes = typeof etat.donneesPhase.secondes === "number" ? etat.donneesPhase.secondes : 60;

  async function envoyer(son: SonEnregistre) {
    setEnvoi("envoie");
    const formulaire = new FormData();
    formulaire.set("audio", new File([son.blob], "parole", { type: son.mime }));
    formulaire.set("partie", etat.partie.id);
    formulaire.set("manche", String(etat.manche));
    formulaire.set("sujet", recette.enonce(etat.donneesPhase));
    formulaire.set("duree", String(son.duree));
    formulaire.set("niveaux", son.niveaux.join(","));

    const reponse = await actionEnvoyerParole(formulaire);
    if (reponse.erreur || !reponse.valeur) {
      setEnvoi("rate");
      return;
    }
    // L'action de jeu part APRÈS : les autres n'apprennent qu'il y a quelque
    // chose à écouter qu'une fois l'audio vraiment rangé.
    moteur.repondre({ parole: reponse.valeur });
    setEnvoi("repos");
  }

  if (revelation) {
    return (
      <div className="flex min-h-[70dvh] flex-col justify-between px-4 py-6">
        <div>
          <p className="text-[22px] font-semibold leading-tight">
            {String(etat.donneesPhase.verdict ?? "")}
          </p>
          {paroleId && (
            <div className="mt-5">
              <p className="mb-2 text-[13px] text-encre-3">
                Gardé dans les souvenirs. On le réécoutera demain.
              </p>
              {/* Le lecteur natif : c'est une réécoute, pas une mise en scène. */}
              <audio controls preload="none" src={`/api/parole/${paroleId}`} className="w-full" />
            </div>
          )}
        </div>
        {moteur.jeSuisHote ? (
          <button
            type="button"
            onClick={moteur.suivante}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="mt-6 w-full rounded-[var(--radius-pilule)] px-4 py-3.5 text-[16px] font-semibold"
          >
            Au suivant
          </button>
        ) : (
          <p className="mt-6 text-center text-[13px] text-encre-3">L&apos;hôte enchaîne.</p>
        )}
      </div>
    );
  }

  // ── Celui qui parle ──────────────────────────────────────────────────────
  if (jeSuisLActeur) {
    return (
      <div className="flex min-h-[70dvh] flex-col justify-between px-4 py-6">
        <div>
          <p className="text-[24px] font-semibold leading-tight tracking-[-0.01em]">
            {recette.enonceActeur?.(etat.donneesPhase) ?? recette.enonce(etat.donneesPhase)}
          </p>
          <p className="mt-3 text-[14px] leading-snug text-encre-2">
            {jeu.cle === "complot"
              ? "Personne ne te coupe. Le plus convaincant gagne, pas le plus vrai."
              : "Soixante secondes pour convaincre deux investisseurs difficiles."}
          </p>
        </div>

        {sienne ? (
          <div className="text-center">
            <p className="text-[15px] text-encre-2">C&apos;est enregistré.</p>
            <p className="mt-1 text-[13px] text-encre-3">
              {reponses.length - 1} sur {joueurs.length - 1} ont noté.
            </p>
          </div>
        ) : (
          <div>
            {envoi === "rate" && (
              <p role="alert" className="mb-3 text-[13px] text-encre-2">
                L&apos;envoi n&apos;est pas passé. Réessaie — rien n&apos;est perdu.
              </p>
            )}
            <EnregistreurVocal
              onFini={(son) => void envoyer(son)}
              desactive={envoi === "envoie"}
              dureeMax={secondes * 1000}
              libelle="Vas-y"
            />
          </div>
        )}
      </div>
    );
  }

  // ── Ceux qui écoutent, puis notent ───────────────────────────────────────
  return (
    <div className="flex min-h-[70dvh] flex-col justify-between px-4 py-6">
      <div>
        <p className="text-[13px] uppercase tracking-[0.08em] text-encre-3">
          {nomActeur} plaide
        </p>
        <p className="mt-2 text-[22px] font-semibold leading-tight">
          {recette.enonce(etat.donneesPhase)}
        </p>
      </div>

      {!paroleId ? (
        <div className="flex flex-col items-center gap-4 py-10">
          <p className="text-center text-[15px] text-encre-2">
            Écoute. {nomActeur} a {secondes} secondes.
          </p>
          <ul className="flex gap-2">
            {joueurs.map((joueur) => (
              <li key={joueur.membreId}>
                <Avatar
                  profil={{
                    id: joueur.membreId,
                    pseudo: joueur.pseudo,
                    teinte: joueur.teinte,
                    initiales: joueur.initiales,
                    avatar: joueur.avatar,
                  }}
                  taille={30}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : maReponse ? (
        <p className="py-10 text-center text-[15px] text-encre-2">C&apos;est noté.</p>
      ) : (
        <div className="py-6">
          <audio controls preload="none" src={`/api/parole/${paroleId}`} className="w-full" />
          {jeu.cle === "complot" ? (
            <>
              <p className="mt-5 mb-2 text-[13px] text-encre-3">Ta note sur dix.</p>
              {/* Dix boutons plutôt qu'un curseur : on note en un geste, sans
                  viser, et on voit ce que vaut « 7 » sans lire un chiffre. */}
              <div className="grid grid-cols-5 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((note) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() => moteur.repondre({ note })}
                    className="cible-tactile rounded-2xl border border-trait bg-surface py-3 text-[17px] font-semibold tabular-nums active:bg-surface-2"
                  >
                    {note}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-5 space-y-2">
              {recette.options(etat.donneesPhase, joueurs, moi).map((option) => (
                <button
                  key={option.cle}
                  type="button"
                  onClick={() => moteur.repondre({ choix: option.cle })}
                  className="cible-tactile w-full rounded-2xl border border-trait bg-surface px-4 py-4 text-left text-[16px] active:bg-surface-2"
                >
                  {option.libelle}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
