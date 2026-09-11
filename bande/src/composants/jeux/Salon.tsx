"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Avatar } from "../Avatar";
import { Carte } from "../Carte";
import { actionDemarrerPartie, actionQuitterSalon } from "@/lib/actions-jeux";
import type { Jeu } from "@/lib/jeux/catalogue";
import type { EtatPartie } from "@/lib/jeux/types";
import { RESSORT } from "@/lib/mouvement";
import type { Profil } from "@/lib/types";

import { useFluxPartie } from "./fluxPartie";
import { useEcranEveille } from "./ecranEveille";
import { sansSilence } from "@/lib/reseau";

/**
 * Le salon : on attend que tout le monde soit là.
 *
 * C'est le seul écran de l'application où l'on attend volontairement, et c'est
 * donc celui où il faut le plus donner à voir. Trois choses, dans cet ordre :
 * qui est déjà là (en direct, c'est ce qui rassure), le code à dicter quand la
 * notification n'arrive pas, et le bouton de lancement — que seul l'hôte voit
 * actif, pour que personne ne lance à sa place.
 *
 * L'écran reste éveillé dès le salon : poser le téléphone pendant que les
 * autres arrivent ne doit pas le faire sortir de la partie.
 */
export function Salon({
  initial,
  jeu,
  moi,
  profils,
}: {
  initial: EtatPartie;
  jeu: Jeu;
  moi: string;
  profils: Profil[];
}) {
  const { etat, relie } = useFluxPartie(initial.partie.id, initial);
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const router = useRouter();

  useEcranEveille(true);

  // Dès que l'hôte lance, tout le monde bascule — le flux l'annonce, et la
  // page se recharge pour rendre le jeu à la place du salon.
  useEffect(() => {
    if (etat && etat.etat === "encours") router.refresh();
  }, [etat, router]);

  if (!etat) {
    return (
      <p className="px-4 py-16 text-center text-[15px] text-encre-2">
        Cette partie n&apos;existe plus.
      </p>
    );
  }

  const jeSuisHote = etat.hoteId === moi;
  const joueurs = etat.partie.joueurs;
  const manquants = profils.filter((p) => !joueurs.some((j) => j.membreId === p.id));

  return (
    <div className="flex min-h-dvh flex-col px-4 pt-3">
      <header className="mb-6 zone-sure-haute">
        <p className="text-[13px] font-medium uppercase tracking-[0.08em] text-encre-3">
          Salon de partie
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-[26px] font-semibold tracking-[-0.02em]">
          <span aria-hidden>{jeu.emoji}</span>
          {jeu.nom}
        </h1>
      </header>

      <Carte className="p-5">
        <p className="text-[13px] text-encre-3">Le code à dicter</p>
        <p className="chiffres mt-1 text-[44px] font-semibold leading-none tracking-[0.12em]">
          {etat.code ?? "—"}
        </p>
        <p className="mt-2.5 text-[13px] leading-snug text-encre-3">
          Les autres le tapent dans Jeux → « Rejoindre ». Ou ils touchent le bandeau
          qui vient d&apos;apparaître en haut de leur accueil.
        </p>
      </Carte>

      <section className="mt-6 flex-1">
        <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-encre-3">
            Dans le salon
          </h2>
          <span className="text-[12px] text-encre-3">
            {relie ? `${joueurs.length} sur ${profils.length}` : "reconnexion…"}
          </span>
        </div>

        <Carte className="divide-y divide-trait">
          <AnimatePresence initial={false}>
            {joueurs.map((joueur) => {
              const profil = profils.find((p) => p.id === joueur.membreId);
              const ici = etat.presents.includes(joueur.membreId);
              return (
                <motion.div
                  key={joueur.membreId}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={RESSORT.moyen}
                  className="flex items-center gap-3 p-4"
                >
                  {profil && <Avatar profil={profil} taille={34} />}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                    {joueur.pseudo}
                    {joueur.membreId === moi && (
                      <span className="ml-2 text-[12px] font-normal text-encre-3">toi</span>
                    )}
                  </span>
                  {etat.hoteId === joueur.membreId && (
                    <span className="shrink-0 text-[12px] text-encre-3">hôte</span>
                  )}
                  {/* Présent ou pas : un point, pas un mot. La liste doit se
                      lire d'un coup d'œil pendant qu'on sert les verres. */}
                  <span
                    aria-label={ici ? "connecté" : "déconnecté"}
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      ici ? "bg-encre-2" : "bg-trait-fort"
                    }`}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>

          {manquants.map((profil) => (
            <div key={profil.id} className="flex items-center gap-3 p-4 opacity-45">
              <Avatar profil={profil} taille={34} />
              <span className="min-w-0 flex-1 truncate text-[15px]">{profil.pseudo}</span>
              <span className="shrink-0 text-[12px] text-encre-3">pas encore là</span>
            </div>
          ))}
        </Carte>
      </section>

      {erreur && (
        <p role="alert" className="mt-4 text-center text-[13px] text-encre-2">
          {erreur}
        </p>
      )}

      <div className="mt-6 mb-4 space-y-2 pb-[env(safe-area-inset-bottom)]">
        {jeSuisHote ? (
          <button
            type="button"
            disabled={enCours || joueurs.length < 2}
            onClick={() =>
              demarrer(async () => {
                const reponse = await actionDemarrerPartie(etat.partie.id);
                if (reponse.erreur) setErreur(reponse.erreur);
                else router.refresh();
              })
            }
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="w-full rounded-[var(--radius-pilule)] px-5 py-3.5 text-[16px] font-semibold transition disabled:opacity-40"
          >
            {joueurs.length < 2 ? "Il faut être au moins deux" : "Lancer la partie"}
          </button>
        ) : (
          <p className="py-2 text-center text-[14px] text-encre-3">
            {etat.partie.joueurs.find((j) => j.membreId === etat.hoteId)?.pseudo ?? "L'hôte"}{" "}
            lance quand tout le monde est là.
          </p>
        )}

        <button
          type="button"
          disabled={enCours}
          onClick={() =>
            demarrer(async () => {
              if (await sansSilence(() => actionQuitterSalon(etat.partie.id), "Le départ")) {
                router.push("/jeux");
              }
            })
          }
          className="cible-tactile w-full py-2.5 text-center text-[14px] text-encre-3 transition hover:text-encre-2"
        >
          Quitter le salon
        </button>
      </div>
    </div>
  );
}
