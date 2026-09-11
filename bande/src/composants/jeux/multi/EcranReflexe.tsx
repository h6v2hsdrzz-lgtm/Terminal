"use client";

import { useEffect, useState } from "react";

import { versLocal } from "@/lib/jeux/salon";

import type { MoteurMulti } from "./CoquilleMulti";
import { COMPTE_MS, PHASES, classementDeVitesse, reponsesDe } from "./protocole";

/**
 * « Le plus rapide », et le seul jeu où la latence changerait le vainqueur.
 *
 * ## Le problème
 *
 * Si le serveur criait « maintenant ! », celui dont le réseau répond en 40 ms
 * gagnerait toujours contre celui qui est à 200 ms. Ce ne serait pas un jeu de
 * réflexe, ce serait un classement d'opérateurs.
 *
 * ## Ce qu'on fait
 *
 * Le serveur annonce **à l'avance** deux instants absolus : le début du
 * décompte 3-2-1, et le vert. Chaque téléphone les ramène à sa propre horloge —
 * d'où le décalage mesuré à chaque état reçu — et compte **en local**. Le
 * réseau ne sert plus qu'à rapporter le résultat.
 *
 * Le temps de réaction est mesuré ici, en millisecondes, et c'est lui qui
 * classe. L'horodatage du serveur ne sert plus que de départage : il ajoutait
 * la latence au réflexe, ce qui se voit dès qu'on affiche des chiffres.
 *
 * ## Ce qui fait perdre
 *
 * Appuyer avant le vert brûle le départ : on boit, et on ne peut plus gagner la
 * manche. Sans ça, la stratégie gagnante serait de marteler l'écran. L'attente
 * avant le vert est tirée entre une et cinq secondes, donc on ne peut pas non
 * plus l'anticiper au chronomètre.
 */
export function EcranReflexe({ moteur }: { moteur: MoteurMulti }) {
  const { etat, joueurs, moi, decalage } = moteur;
  // Une horloge locale qui bat pendant l'attente, plutôt qu'un état qu'on
  // bascule : le vert et le décompte se DÉDUISENT du temps, ils ne se décrètent
  // pas. C'est ce qui les rend justes même si le composant se remonte au milieu
  // — un flux qui se reconnecte, par exemple.
  const [maintenant, setMaintenant] = useState(() => Date.now());

  const departA =
    typeof etat.donneesPhase.departA === "string"
      ? versLocal(etat.donneesPhase.departA, decalage)
      : null;
  const compteA =
    typeof etat.donneesPhase.compteA === "string"
      ? versLocal(etat.donneesPhase.compteA, decalage)
      : null;

  const revelation = etat.phase === PHASES.revelation;
  const reponses = reponsesDe(etat, revelation ? PHASES.depart : (etat.phase ?? ""));
  const maReponse = reponses.find((r) => r.membreId === moi);

  const duellistes = Array.isArray(etat.donneesPhase.duellistes)
    ? (etat.donneesPhase.duellistes as string[])
    : null;
  const jArbitre = duellistes !== null && !duellistes.includes(moi);

  const vert = departA !== null && maintenant >= departA;
  /** Le chiffre du décompte : 3, 2, 1, puis rien. */
  const compte =
    compteA !== null && maintenant < compteA + COMPTE_MS
      ? Math.max(1, Math.ceil((compteA + COMPTE_MS - maintenant) / 1000))
      : null;

  useEffect(() => {
    if (departA === null || vert) return;
    // Cinquante millisecondes : en dessous on rend pour rien, au-dessus le
    // passage au vert se voit arriver en retard sur un jeu qui se mesure en
    // centièmes.
    const battement = setInterval(() => setMaintenant(Date.now()), 50);
    return () => clearInterval(battement);
  }, [departA, vert]);

  /**
   * Appuyer.
   *
   * Le temps est pris ICI, à l'instant du geste, et pas au retour du serveur :
   * c'est tout l'objet du jeu. Une vibration courte confirme l'appui — sur un
   * écran qui change de couleur au même moment, le doigt doute.
   */
  function appuyer() {
    if (maReponse || jArbitre || departA === null) return;
    const ecart = Date.now() - departA;
    if (navigator.vibrate) navigator.vibrate(ecart >= 0 ? 12 : [6, 40, 6]);
    moteur.repondre(ecart >= 0 ? { ms: ecart } : { faux: true });
  }

  if (revelation) {
    const classement = classementDeVitesse(reponses);
    const meilleur = classement.find((c) => c.reponse.donnees.faux !== true);
    const msDe = (donnees: Record<string, unknown>) =>
      typeof donnees.ms === "number" ? donnees.ms : null;
    const reference = meilleur ? msDe(meilleur.reponse.donnees) : null;

    return (
      <div className="flex min-h-[70dvh] flex-col justify-between px-4 py-6">
        <div>
          <p className="text-[24px] font-semibold leading-tight">
            {String(etat.donneesPhase.verdict ?? "")}
          </p>
          <ul className="mt-5 space-y-2.5">
            {classement.map(({ reponse, rang }) => {
              const joueur = joueurs.find((j) => j.membreId === reponse.membreId);
              const brule = reponse.donnees.faux === true;
              const ms = msDe(reponse.donnees);
              const ecart = ms !== null && reference !== null ? ms - reference : null;
              return (
                <li
                  key={reponse.membreId}
                  className="flex items-baseline justify-between gap-3 text-[15px]"
                >
                  <span>
                    {brule ? "🔥 " : `${rang}. `}
                    {joueur?.pseudo ?? "quelqu'un"}
                  </span>
                  {/* Le temps en TRÈS gros : c'est le résultat du jeu, pas une
                      note de bas de page. L'écart au premier juste à côté, en
                      petit — « +0,08 s » raconte la manche mieux qu'un rang. */}
                  <span className="flex items-baseline gap-2">
                    {brule || ms === null ? (
                      <span className="chiffres text-[15px] text-encre-3">trop tôt</span>
                    ) : (
                      <>
                        <span className="chiffres text-[30px] font-semibold tabular-nums leading-none">
                          {Math.round(ms)}
                        </span>
                        <span className="text-[12px] text-encre-3">ms</span>
                        {ecart !== null && ecart > 0 && (
                          <span className="chiffres text-[13px] text-encre-3">
                            +{(ecart / 1000).toFixed(2).replace(".", ",")} s
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-3">
          {/* Le mode, réglable entre deux manches et par l'hôte seul. Changer la
              règle au milieu d'un tour n'aurait aucun sens. */}
          {moteur.jeSuisHote && joueurs.length >= 3 && (
            <button
              type="button"
              onClick={() => moteur.reglerOption("duel", moteur.options.duel !== true)}
              className="cible-tactile w-full rounded-[var(--radius-pilule)] border border-trait py-2.5 text-center text-[14px] text-encre-2"
            >
              {moteur.options.duel === true
                ? "Duel — passer à tous en même temps"
                : "Tous en même temps — passer en duel"}
            </button>
          )}
          {moteur.jeSuisHote ? (
            <button
              type="button"
              onClick={moteur.suivante}
              style={{ background: "var(--encre)", color: "var(--surface)" }}
              className="w-full rounded-[var(--radius-pilule)] px-4 py-3.5 text-[16px] font-semibold"
            >
              {etat.manche >= 5 ? "Voir le podium" : "On remet ça"}
            </button>
          ) : (
            <p className="text-center text-[13px] text-encre-3">L&apos;hôte enchaîne.</p>
          )}
        </div>
      </div>
    );
  }

  // ── L'arbitre : il ne joue pas cette manche, il regarde les deux autres ───
  if (jArbitre) {
    const noms = duellistes
      .map((id) => joueurs.find((j) => j.membreId === id)?.pseudo ?? "quelqu'un")
      .join(" contre ");
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-[13px] uppercase tracking-[0.08em] text-encre-3">Tu arbitres</p>
        <p className="text-[26px] font-semibold tracking-[-0.02em]">{noms}</p>
        <p className="chiffres text-[64px] font-semibold tabular-nums leading-none text-encre-3">
          {compte ?? (vert ? "—" : "…")}
        </p>
        <p className="text-[14px] text-encre-2">
          {reponses.length} sur {duellistes.length} ont appuyé.
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={maReponse !== undefined}
      onClick={appuyer}
      // La zone entière est le bouton : viser une cible avec le pouce
      // ajouterait au temps de réaction ce que le jeu essaie de mesurer.
      className="flex min-h-[78dvh] w-full flex-col items-center justify-center gap-3 px-4 transition-colors"
      style={{ background: vert ? "var(--joie-9)" : "var(--surface-2)" }}
    >
      {compte !== null && !maReponse ? (
        <>
          <span className="chiffres text-[120px] font-semibold tabular-nums leading-none">
            {compte}
          </span>
          <span className="text-[14px] text-encre-2">Prépare-toi.</span>
        </>
      ) : (
        <>
          <span className="text-[34px] font-semibold tracking-[-0.02em]">
            {maReponse
              ? maReponse.donnees.faux === true
                ? "Trop tôt."
                : `${Math.round((maReponse.donnees.ms as number) ?? 0)} ms`
              : vert
                ? "MAINTENANT"
                : "Attends…"}
          </span>
          <span className="text-[14px] text-encre-2">
            {maReponse
              ? `${reponses.length} sur ${duellistes?.length ?? etat.presents.length} ont appuyé.`
              : vert
                ? "Appuie n'importe où."
                : "Appuyer avant le vert fait boire."}
          </span>
        </>
      )}
    </button>
  );
}
