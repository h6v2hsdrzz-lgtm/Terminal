"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { RESSORT } from "@/lib/mouvement";
// La même normalisation qu'au serveur : sans elle, l'écran laisserait ajouter
// un doublon que la base refuserait ensuite de dédoubler.
import { LONGUEUR_ETIQUETTE, MAX_ETIQUETTES, cleEtiquette as cle, nettoyerEtiquette } from "@/lib/etiquettes";

/**
 * Le lieu d'une journée — plusieurs, au besoin.
 *
 * Les déclencheurs sont fixes et décidés par la bande ; les lieux sont libres
 * et s'inventent au fil des mois. Les deux coexistent : « boulot » est un
 * déclencheur qu'on retrouve chaque semaine, « chez Mamie » est un lieu qui
 * n'aura de sens que cette année-là.
 *
 * Le stockage s'appelle encore « étiquette », et c'est voulu : renommer les
 * tables et les colonnes pour un mot d'interface, ce serait une migration
 * risquée sans rien de visible. Le libellé change, la donnée reste.
 *
 * Ce qui part au serveur est un champ caché : une chaîne séparée par des
 * virgules. Ça garde le formulaire fonctionnel sans JavaScript — on tape
 * directement dans le champ visible, et il porte le même nom.
 */
export function ChampEtiquettes({
  proposees,
  initiales = [],
}: {
  /** Celles que la bande utilise déjà, les plus fréquentes d'abord. */
  proposees: { id: string; nom: string }[];
  initiales?: string[];
}) {
  const [choisies, setChoisies] = useState<string[]>(initiales);
  const [saisie, setSaisie] = useState("");
  const [cherche, setCherche] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  // « nom|latitude|longitude » du lieu venu de la géolocalisation, le cas échéant.
  const [position, setPosition] = useState("");
  const complet = choisies.length >= MAX_ETIQUETTES;

  /**
   * « Utiliser ma position ».
   *
   * La position ne part jamais telle quelle vers un tiers : elle est arrondie
   * à un kilomètre par le serveur, qui interroge OpenStreetMap à notre place.
   * Le service ne voit donc ni l'adresse IP du téléphone, ni la position
   * exacte. Et rien ne se déclenche sans ce bouton : la permission est
   * demandée par le geste, jamais au chargement.
   */
  function localiser() {
    if (!navigator.geolocation) {
      setRefus("Ce navigateur ne sait pas donner ta position.");
      return;
    }
    setRefus(null);
    setCherche(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const reponse = await fetch(`/api/lieu?lat=${latitude}&lon=${longitude}`);
          const { nom, position: arrondie } = (await reponse.json()) as {
            nom: string | null;
            position?: { latitude: number; longitude: number };
          };
          if (nom) {
            ajouter(nom);
            // La position stockée est celle que le serveur a arrondie, pas
            // celle du GPS : on ne renvoie jamais la précision d'origine.
            if (arrondie) setPosition(`${nom}|${arrondie.latitude}|${arrondie.longitude}`);
          }
          else setRefus("Aucun nom trouvé pour cet endroit. Écris-le à la main.");
        } catch {
          setRefus("La recherche a échoué. Écris-le à la main.");
        } finally {
          setCherche(false);
        }
      },
      () => {
        setCherche(false);
        setRefus("Position refusée. Le champ reste libre.");
      },
      // Pas de haute précision : on arrondit de toute façon à un kilomètre, et
      // le GPS fin vide la batterie pour un résultat qu'on jette.
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }

  function ajouter(nom: string) {
    const propre = nettoyerEtiquette(nom);
    if (!cle(propre) || complet) return;
    if (choisies.some((c) => cle(c) === cle(propre))) return;
    setChoisies([...choisies, propre]);
    setSaisie("");
  }

  function toucheAppuyee(evenement: React.KeyboardEvent<HTMLInputElement>) {
    // Entrée valide l'étiquette sans envoyer le formulaire — on est au milieu
    // de la saisie, pas au bout.
    if (evenement.key === "Enter" || evenement.key === ",") {
      evenement.preventDefault();
      ajouter(saisie);
    } else if (evenement.key === "Backspace" && saisie === "" && choisies.length > 0) {
      setChoisies(choisies.slice(0, -1));
    }
  }

  const restantes = proposees
    .filter((p) => !choisies.some((c) => cle(c) === cle(p.nom)))
    .filter((p) => (saisie ? cle(p.nom).includes(cle(saisie)) : true))
    .slice(0, 6);

  return (
    <div className="mt-4">
      <input type="hidden" name="etiquettes" value={choisies.join(",")} />
      {position && <input type="hidden" name="lieuPosition" value={position} />}

      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-trait bg-surface-2 px-2.5 py-2">
        <AnimatePresence initial={false}>
          {choisies.map((nom) => (
            <motion.button
              key={nom}
              type="button"
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={RESSORT.vif}
              onClick={() => setChoisies(choisies.filter((c) => c !== nom))}
              className="inline-flex items-center gap-1 rounded-[var(--radius-pilule)] bg-surface-3 px-2.5 py-1 text-[13px] text-encre-2"
            >
              {nom}
              <span aria-hidden className="text-encre-3">×</span>
              <span className="sr-only">retirer</span>
            </motion.button>
          ))}
        </AnimatePresence>

        <input
          type="text"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={toucheAppuyee}
          // Une étiquette tapée puis laissée en plan doit compter : personne
          // n'imagine devoir « valider » un mot avant d'envoyer.
          onBlur={() => ajouter(saisie)}
          maxLength={LONGUEUR_ETIQUETTE}
          disabled={complet}
          aria-label="Ajouter un lieu"
          placeholder={choisies.length === 0 ? "Où ? (facultatif)" : ""}
          // `champ-saisie` tient la taille à 16px : en dessous, Safari zoome sur
          // le champ à la mise au point et ne dézoome jamais.
          className="champ-saisie min-w-[7rem] flex-1 bg-transparent py-0.5 placeholder:text-encre-3 focus:outline-none"
        />
      </div>

      {!complet && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={localiser}
            disabled={cherche}
            className="cible-tactile inline-flex items-center gap-1.5 text-[13px] text-encre-2 underline underline-offset-2 disabled:opacity-50"
          >
            <span aria-hidden>◎</span> {cherche ? "un instant…" : "utiliser ma position"}
          </button>
          {refus && <span className="text-[12px] text-encre-3">{refus}</span>}
        </div>
      )}

      {restantes.length > 0 && !complet && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {restantes.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                // Sans ça, appuyer sur une proposition sort d'abord du champ,
                // ce qui pose le mot à moitié tapé, refiltre la liste, et fait
                // disparaître le bouton sous le doigt avant que le clic
                // n'arrive. Empêcher le comportement par défaut de `mousedown`
                // garde le champ actif : seul le clic agit.
                onMouseDown={(evenement) => evenement.preventDefault()}
                onClick={() => ajouter(p.nom)}
                className="rounded-[var(--radius-pilule)] border border-trait px-2.5 py-1 text-[13px] text-encre-3 transition hover:border-trait-fort hover:text-encre-2"
              >
                {p.nom}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
