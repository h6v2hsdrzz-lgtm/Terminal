"use client";

import { useState } from "react";

import { Avatar } from "../../Avatar";
import type { MoteurMulti } from "./CoquilleMulti";
import { PHASES, reponsesDe } from "./protocole";

/**
 * « Le mot de passe » : le jeu qu'on ne regarde pas.
 *
 * C'est le seul de la maison dont l'écran doit être **inintéressant**. On le
 * lance, on lit son mot, on pose le téléphone, et on joue à autre chose pendant
 * une heure. On n'y revient que pour une chose : accuser quelqu'un d'avoir placé
 * le sien.
 *
 * D'où deux choix qui vont ensemble : le jeu est marqué « de fond » au
 * catalogue — il ne bloque pas le lancement des autres — et cet écran ne
 * cherche pas à retenir. Pas de minuteur, pas d'animation, rien qui clignote.
 *
 * **Ton mot ne s'affiche que chez toi.** Il voyage pourtant dans la phase, avec
 * ceux des autres, comme le nom de « Devine qui je suis » voyage jusqu'à celui
 * qui ne doit pas le voir. Quelqu'un qui ouvre les outils de développement
 * verrait les trois : c'est un jeu entre amis, pas un protocole, et le dire est
 * plus honnête que de faire semblant.
 */
export function EcranFond({ moteur }: { moteur: MoteurMulti }) {
  const { etat, joueurs, moi } = moteur;
  const [vise, setVise] = useState<string | null>(null);
  const [mot, setMot] = useState("");

  const revelation = etat.phase === PHASES.revelation;
  const reponses = reponsesDe(etat, revelation ? PHASES.question : (etat.phase ?? ""));
  const maReponse = reponses.find((r) => r.membreId === moi);
  const mots = (etat.donneesPhase.mots ?? {}) as Record<string, string>;
  const monMot = mots[moi] ?? "";
  const autres = joueurs.filter((j) => j.membreId !== moi);

  /**
   * Combien ont déjà accusé.
   *
   * Sans ça, celui qui retourne les cartes ne sait pas s'il coupe une manche où
   * quelqu'un vient d'accuser — et un test ne sait pas non plus quand
   * l'accusation est arrivée chez l'hôte. Une ligne, et les deux problèmes
   * tombent.
   */
  const compteur =
    reponses.length === 0
      ? "Personne n'a encore accusé."
      : `${reponses.length} sur ${joueurs.length} ${reponses.length > 1 ? "ont" : "a"} accusé.`;

  if (revelation) {
    return (
      <div className="flex min-h-[70dvh] flex-col justify-between px-4 py-6">
        <div>
          <p className="text-[22px] font-semibold leading-tight">
            {String(etat.donneesPhase.verdict ?? "")}
          </p>
          <ul className="mt-5 space-y-2">
            {joueurs.map((joueur) => (
              <li key={joueur.membreId} className="flex items-center gap-3 text-[15px]">
                <Avatar
                  profil={{
                    id: joueur.membreId,
                    pseudo: joueur.pseudo,
                    teinte: joueur.teinte,
                    initiales: joueur.initiales,
                    avatar: joueur.avatar,
                  }}
                  taille={28}
                />
                <span className="flex-1 truncate">{joueur.pseudo}</span>
                <span className="text-encre-3">{mots[joueur.membreId] ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
        {moteur.jeSuisHote ? (
          <button
            type="button"
            onClick={moteur.suivante}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="mt-6 w-full rounded-[var(--radius-pilule)] px-4 py-3.5 text-[16px] font-semibold"
          >
            Nouveaux mots
          </button>
        ) : (
          <p className="mt-6 text-center text-[13px] text-encre-3">
            L&apos;hôte redistribue quand vous voulez.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-[70dvh] flex-col justify-between px-4 py-6">
      <div>
        <p className="text-[13px] uppercase tracking-[0.08em] text-encre-3">Ton mot</p>
        <p className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.03em]">
          {monMot || "—"}
        </p>
        <p className="mt-3 text-[14px] leading-snug text-encre-2">
          Place-le dans la conversation sans qu&apos;on te grille. Pose le téléphone
          et joue à autre chose : cette partie-là ne bloque rien.
        </p>
      </div>

      {maReponse ? (
        <div className="py-8 text-center">
          <p className="text-[15px] text-encre-2">Accusation envoyée. On verra bien.</p>
          <p className="mt-1 text-[13px] text-encre-3">{compteur}</p>
          {moteur.jeSuisHote && (
            <button
              type="button"
              onClick={moteur.revelerMaintenant}
              className="cible-tactile mt-4 text-[14px] text-encre-3 underline underline-offset-2"
            >
              Retourner les cartes
            </button>
          )}
        </div>
      ) : (
        <div>
          <p className="mb-2 text-[13px] text-encre-3">Je te grille</p>
          <div className="flex gap-2">
            {autres.map((joueur) => (
              <button
                key={joueur.membreId}
                type="button"
                onClick={() => setVise(vise === joueur.membreId ? null : joueur.membreId)}
                aria-pressed={vise === joueur.membreId}
                className={`cible-tactile flex-1 rounded-2xl border px-3 py-3 text-[15px] font-semibold ${
                  vise === joueur.membreId
                    ? "border-encre-3 bg-surface-3"
                    : "border-trait bg-surface"
                }`}
              >
                {joueur.pseudo}
              </button>
            ))}
          </div>

          <input
            value={mot}
            onChange={(e) => setMot(e.target.value)}
            placeholder="Le mot que tu as entendu"
            className="champ-saisie mt-3 w-full rounded-2xl border border-trait bg-surface-2 px-4 py-3 placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
          />

          <button
            type="button"
            disabled={!vise || !mot.trim()}
            onClick={() => moteur.repondre({ vise, mot: mot.trim() })}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="mt-3 w-full rounded-[var(--radius-pilule)] px-4 py-3.5 text-[16px] font-semibold disabled:opacity-40"
          >
            Je te grille
          </button>
          <p className="mt-2 text-center text-[12px] text-encre-3">
            Juste, tu marques un point. À côté, tu en perds un. {compteur}
          </p>
          {/* La seule sortie du jeu : il n'a pas de fin mécanique, personne
              n'est obligé d'accuser, et sans ce bouton on ne saurait jamais qui
              avait quel mot. */}
          {moteur.jeSuisHote && (
            <button
              type="button"
              onClick={moteur.revelerMaintenant}
              className="cible-tactile mt-4 w-full py-2 text-center text-[14px] text-encre-3 underline underline-offset-2"
            >
              Retourner les cartes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
