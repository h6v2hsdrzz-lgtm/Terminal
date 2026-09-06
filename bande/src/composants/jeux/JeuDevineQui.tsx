"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Avatar } from "@/composants/Avatar";
import type { Moteur } from "./CoquilleJeu";
import { gravitéÉcran, prochaineAction } from "@/lib/jeux/inclinaison";
import { PAQUETS, toutesLesCartes } from "@/lib/jeux/contenu/paquets";
import type { CarteMaison } from "@/lib/jeux/types";
import { PaquetDeLaBande } from "./PaquetDeLaBande";
import { generateur, pioche } from "@/lib/jeux/tirage";

/**
 * « Devine qui je suis » — le jeu phare.
 *
 * Le joueur pose le téléphone sur son front, le nom s'affiche en très grand,
 * les deux autres le font deviner. Pencher vers le bas : trouvé. Vers le haut :
 * passer.
 *
 * ## Trois décisions
 *
 * **Les zones tactiles sont TOUJOURS actives**, pas seulement en repli. Le plan
 * prévoyait le tap si le capteur est refusé ou absent ; on va plus loin, parce
 * qu'un capteur d'inclinaison ne se vérifie pas depuis un test automatisé, et
 * qu'un jeu dont la seule commande dépend d'un chemin invérifiable est un jeu
 * qui peut ne pas démarrer le soir venu. La moitié gauche passe, la moitié
 * droite valide — le pouce d'un pote y arrive sans réfléchir.
 *
 * **La permission des capteurs est demandée sur un vrai appui.** iOS l'exige
 * (`DeviceOrientationEvent.requestPermission`), et la demander au chargement
 * la fait refuser sans que personne ne comprenne ce qui a été refusé.
 *
 * **Le texte rétrécit avec la longueur du nom.** « IAM » et « Le fabuleux
 * destin d'Amélie Poulain » ne peuvent pas s'écrire dans le même corps sur un
 * écran qu'on lit à deux mètres.
 */
const DUREE = 60_000;
const DERNIERES_SECONDES = 5;

type Phase = "choix" | "consigne" | "manche" | "recap";
type Resultat = { carte: string; trouvee: boolean };

export function JeuDevineQui({
  moteur,
  cartesMaison,
}: {
  moteur: Moteur;
  cartesMaison: CarteMaison[];
}) {
  const [phase, setPhase] = useState<Phase>("choix");
  const [paquet, setPaquet] = useState<string>("roulette");
  const [tour, setTour] = useState(0);
  const [carte, setCarte] = useState("");
  const [resultats, setResultats] = useState<Resultat[]>([]);
  const [reste, setReste] = useState(DUREE);
  const [éclat, setÉclat] = useState<"trouve" | "passe" | null>(null);
  const [capteur, setCapteur] = useState<"absent" | "refuse" | "actif" | "inconnu">("inconnu");
  const [graine] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [potes, setPotes] = useState(cartesMaison);

  const joueur = moteur.joueurs[tour % moteur.joueurs.length];
  const cartes = useMemo(() => {
    if (paquet === "potes") return potes.map((c) => c.texte);
    // La roulette prend tout, y compris le paquet de la bande : c'est là qu'il
    // est le plus drôle, au milieu des rappeurs et des objets de mamie.
    if (paquet === "roulette") return [...toutesLesCartes(), ...potes.map((c) => c.texte)];
    return PAQUETS.find((p) => p.cle === paquet)?.cartes ?? [];
  }, [paquet, potes]);

  /**
   * Le tas vit dans une référence, pas dans un `useMemo`.
   *
   * Une pioche a une mémoire — c'est même toute sa raison d'être : ne pas
   * redonner la même carte avant d'avoir fait le tour du paquet. Or React a le
   * droit de jeter un `useMemo` quand il veut ; le jour où il le fait, le tas
   * est remélangé au milieu d'une manche et les cartes déjà vues reviennent.
   * On le fabrique donc au lancement de la manche, une fois.
   */
  const tas = useRef<ReturnType<typeof pioche<string>> | null>(null);

  /**
   * Le geste, quelle qu'en soit la source.
   *
   * La référence garde la dernière version de la fonction sans réabonner
   * l'écouteur d'inclinaison à chaque carte. Elle est affectée dans un effet :
   * écrire une référence pendant le rendu, c'est écrire pendant que React
   * décide encore de ce qu'il affiche.
   */
  const suite = useRef<(action: "trouve" | "passe") => void>(() => {});
  useEffect(() => {
    suite.current = (action) => {
      setResultats((avant) => [...avant, { carte, trouvee: action === "trouve" }]);
      setÉclat(action);
      setCarte(tas.current?.suivante() ?? "");
      if (action === "trouve" && "vibrate" in navigator) navigator.vibrate(35);
    };
  });

  useEffect(() => {
    if (éclat === null) return;
    const minuteur = setTimeout(() => setÉclat(null), 260);
    return () => clearTimeout(minuteur);
  }, [éclat]);

  // Le chrono, et le bip des cinq dernières secondes.
  useEffect(() => {
    if (phase !== "manche") return;
    const debut = Date.now();
    const battement = setInterval(() => {
      const restant = Math.max(0, DUREE - (Date.now() - debut));
      setReste(restant);
      if (restant === 0) {
        clearInterval(battement);
        setPhase("recap");
      }
    }, 100);
    return () => clearInterval(battement);
  }, [phase]);

  const secondes = Math.ceil(reste / 1000);
  const finImminente = phase === "manche" && secondes <= DERNIERES_SECONDES;

  useEffect(() => {
    if (!finImminente) return;
    // Un bip par seconde, fabriqué à la volée : charger un fichier son pour
    // cinq notes coûterait une requête et un octet de plus dans le bundle.
    if ("vibrate" in navigator) navigator.vibrate(12);
  }, [finImminente, secondes]);

  // L'inclinaison.
  useEffect(() => {
    if (phase !== "manche" || capteur !== "actif") return;
    let arme = true;
    const ecouter = (evenement: DeviceOrientationEvent) => {
      const g = gravitéÉcran(evenement.beta, evenement.gamma);
      const suivant = prochaineAction(g, arme);
      arme = suivant.arme;
      if (suivant.action) suite.current(suivant.action);
    };
    window.addEventListener("deviceorientation", ecouter);
    return () => window.removeEventListener("deviceorientation", ecouter);
  }, [phase, capteur]);

  const demanderCapteur = useCallback(async () => {
    type AvecPermission = { requestPermission?: () => Promise<PermissionState | "granted" | "denied"> };
    const classe = (globalThis as { DeviceOrientationEvent?: AvecPermission }).DeviceOrientationEvent;
    if (!classe) {
      setCapteur("absent");
      return;
    }
    if (typeof classe.requestPermission !== "function") {
      // Android et les navigateurs de bureau : pas de demande à faire.
      setCapteur("actif");
      return;
    }
    try {
      setCapteur((await classe.requestPermission()) === "granted" ? "actif" : "refuse");
    } catch {
      setCapteur("refuse");
    }
  }, []);

  // Le plein écran est demandé à l'entrée de la manche et rendu à sa sortie.
  useEffect(() => {
    moteur.pleinEcran(phase === "manche");
  }, [phase, moteur]);

  function lancerManche() {
    // Un tas neuf par manche : chaque joueur part du paquet entier, et deux
    // manches d'affilée ne se partagent pas les cartes déjà sorties.
    tas.current = pioche(cartes, generateur(graine + tour));
    setResultats([]);
    setCarte(tas.current.suivante());
    setReste(DUREE);
    setPhase("manche");
  }

  function finirManche() {
    const trouvees = resultats.filter((r) => r.trouvee).length;
    if (trouvees > 0) moteur.marquer([{ membreId: joueur.membreId, delta: trouvees }]);
    moteur.manche({ jeu: "devine-qui", paquet, resultats }, joueur.membreId);
    setTour(tour + 1);
    setPhase("consigne");
  }

  if (phase === "choix") {
    return (
      <div className="px-4 py-6">
        <h2 className="text-[22px] font-semibold tracking-tight">Quel paquet ?</h2>
        <ul className="mt-4 grid grid-cols-2 gap-2">
          <li className="col-span-2">
            <button
              type="button"
              onClick={() => setPaquet("roulette")}
              aria-pressed={paquet === "roulette"}
              className={`cible-tactile w-full rounded-[var(--radius-carte)] border px-4 py-3 text-left ${
                paquet === "roulette" ? "border-transparent bg-surface-3" : "border-trait"
              }`}
            >
              <span className="text-[16px] font-semibold">🎰 Roulette</span>
              <span className="block text-[13px] text-encre-3">
                Tout, mélangé — {toutesLesCartes().length} cartes
              </span>
            </button>
          </li>
          {PAQUETS.map((p) => (
            <li key={p.cle}>
              <button
                type="button"
                onClick={() => setPaquet(p.cle)}
                aria-pressed={paquet === p.cle}
                className={`cible-tactile h-full w-full rounded-[var(--radius-carte)] border px-3 py-2.5 text-left ${
                  paquet === p.cle ? "border-transparent bg-surface-3" : "border-trait"
                }`}
              >
                <span className="text-[15px] font-semibold">
                  {p.emoji} {p.nom}
                </span>
                <span className="block text-[12px] text-encre-3">{p.cartes.length} cartes</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setPaquet("potes")}
          aria-pressed={paquet === "potes"}
          className={`cible-tactile mt-3 w-full rounded-[var(--radius-carte)] border px-4 py-3 text-left ${
            paquet === "potes" ? "border-transparent bg-surface-3" : "border-trait"
          }`}
        >
          <span className="text-[16px] font-semibold">👥 Nos potes</span>
          <span className="block text-[13px] text-encre-3">
            {potes.length} carte{potes.length > 1 ? "s" : ""} écrite
            {potes.length > 1 ? "s" : ""} par vous
          </span>
        </button>

        <PaquetDeLaBande cartes={potes} surChangement={setPotes} />

        <button
          type="button"
          onClick={() => setPhase("consigne")}
          disabled={cartes.length < 5}
          className="cible-tactile mt-5 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface disabled:opacity-40"
        >
          Choisir ce paquet
        </button>
      </div>
    );
  }

  if (phase === "consigne") {
    return (
      <div className="flex min-h-[62dvh] flex-col items-center justify-center px-6 text-center">
        <Avatar
          profil={{
            id: joueur.membreId,
            pseudo: joueur.pseudo,
            teinte: joueur.teinte,
            initiales: joueur.initiales,
            avatar: joueur.avatar,
          }}
          taille={72}
        />
        <p className="mt-4 text-[24px] font-semibold tracking-tight">À toi, {joueur.pseudo}</p>
        <p className="mt-2 max-w-[30ch] text-[15px] leading-snug text-encre-2">
          Pose le téléphone sur ton front, écran vers les autres. Penche vers le bas
          quand c&apos;est trouvé, vers le haut pour passer — ou laisse un pote toucher
          l&apos;écran : à droite trouvé, à gauche passer.
        </p>

        {capteur === "inconnu" && (
          <button
            type="button"
            onClick={demanderCapteur}
            className="cible-tactile mt-5 rounded-[var(--radius-pilule)] border border-trait px-4 py-2.5 text-[15px]"
          >
            Activer l&apos;inclinaison
          </button>
        )}
        {capteur === "refuse" && (
          <p className="mt-4 text-[14px] text-encre-3">
            Sans capteur, on joue au doigt. C&apos;est exactement pareil.
          </p>
        )}
        {capteur === "absent" && (
          <p className="mt-4 text-[14px] text-encre-3">
            Ce navigateur n&apos;a pas de capteur d&apos;inclinaison. On joue au doigt.
          </p>
        )}
        {capteur === "actif" && (
          <p className="mt-4 text-[14px] text-encre-3">Inclinaison active.</p>
        )}

        <button
          type="button"
          onClick={lancerManche}
          className="cible-tactile mt-7 w-full max-w-xs rounded-[var(--radius-pilule)] bg-encre px-4 py-3.5 text-[17px] font-semibold text-surface"
        >
          Prêt — 60 secondes
        </button>
        {tour > 0 && (
          <button
            type="button"
            onClick={moteur.terminer}
            className="cible-tactile mt-2 text-[14px] text-encre-3"
          >
            Arrêter là et voir le classement
          </button>
        )}
      </div>
    );
  }

  if (phase === "recap") {
    const trouvees = resultats.filter((r) => r.trouvee);
    const passees = resultats.filter((r) => !r.trouvee);
    return (
      <div className="px-4 py-7">
        <p className="text-[15px] text-encre-3">{joueur.pseudo}</p>
        <p className="mt-1 text-[34px] font-semibold tabular-nums tracking-tight">
          {trouvees.length}
          <span className="text-[18px] font-normal text-encre-3">
            {" "}
            trouvée{trouvees.length > 1 ? "s" : ""}
          </span>
        </p>

        {trouvees.length > 0 && (
          <ul className="mt-4 space-y-1">
            {trouvees.map((r, i) => (
              <li key={`${r.carte}-${i}`} className="text-[15px]">
                ✓ {r.carte}
              </li>
            ))}
          </ul>
        )}
        {passees.length > 0 && (
          <ul className="mt-3 space-y-1">
            {passees.map((r, i) => (
              <li key={`${r.carte}-${i}`} className="text-[15px] text-encre-3">
                — {r.carte}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={finirManche}
          className="cible-tactile mt-7 w-full rounded-[var(--radius-pilule)] bg-encre px-4 py-3 text-[16px] font-semibold text-surface"
        >
          Au suivant
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-[100dvh] select-none flex-col items-center justify-center overflow-hidden px-5 text-center"
      style={{ touchAction: "none" }}
    >
      {/* Les deux moitiés tactiles, sous le texte : à gauche on passe, à droite
          on valide. Elles restent là même quand l'inclinaison marche. */}
      <button
        type="button"
        aria-label="Passer cette carte"
        onClick={() => suite.current("passe")}
        className="absolute inset-y-0 left-0 z-10 w-1/2"
      />
      <button
        type="button"
        aria-label="Carte trouvée"
        onClick={() => suite.current("trouve")}
        className="absolute inset-y-0 right-0 z-10 w-1/2"
      />

      <AnimatePresence>
        {éclat && (
          <motion.div
            key={éclat + resultats.length}
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.26 }}
            className={`pointer-events-none absolute inset-0 ${
              éclat === "trouve" ? "bg-[var(--joie-haut)]" : "bg-surface-3"
            }`}
          />
        )}
      </AnimatePresence>

      <p
        className={`pointer-events-none relative text-[46px] font-semibold tabular-nums tracking-tight ${
          finImminente ? "text-[var(--alerte)]" : "text-encre-3"
        }`}
      >
        {secondes}
      </p>
      <p
        className="pointer-events-none relative mt-2 font-semibold leading-[1.05] tracking-tight"
        style={{ fontSize: `clamp(30px, ${Math.max(34, 132 - carte.length * 3.4)}px, 76px)` }}
      >
        {carte}
      </p>
      <p className="pointer-events-none relative mt-8 text-[13px] text-encre-3">
        ← passer · trouvé →
      </p>
    </div>
  );
}
