"use client";

import { useEffect, useRef, useState } from "react";

import type { Audio } from "@/lib/types";
import { ondeNormalisee } from "@/lib/onde";

/**
 * La note vocale, dans le fil.
 *
 * La forme d'onde est dessinée à partir des niveaux mesurés à
 * l'enregistrement — c'est vraiment ce son-là, pas un motif décoratif qui
 * serait le même pour tout le monde. La position de lecture avance dessus.
 *
 * Deux règles que le brief demande, et qu'on tient ici :
 *
 * · **un seul son à la fois.** Un événement global arrête les autres lecteurs
 *   quand l'un démarre. Sans ça, trois notes se superposent dès qu'on tape vite ;
 * · **arrêt quand on quitte l'écran.** L'onglet caché ou le composant démonté
 *   coupent la lecture — un son qui continue depuis une page qu'on ne voit plus
 *   est incompréhensible.
 */
const AUTRE_LECTURE = "bande:lecture-audio";

export function LecteurVocal({
  audio,
  couleur,
  nom,
}: {
  audio: Audio;
  couleur: string;
  nom: string;
}) {
  const element = useRef<HTMLAudioElement>(null);
  const [joue, setJoue] = useState(false);
  const [avancement, setAvancement] = useState(0);

  useEffect(() => {
    const son = element.current;
    if (!son) return;

    // Un autre lecteur démarre : on s'arrête.
    const stopper = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== audio.url) {
        son.pause();
      }
    };
    const auMasquage = () => { if (document.visibilityState === "hidden") son.pause(); };

    window.addEventListener(AUTRE_LECTURE, stopper);
    document.addEventListener("visibilitychange", auMasquage);
    return () => {
      window.removeEventListener(AUTRE_LECTURE, stopper);
      document.removeEventListener("visibilitychange", auMasquage);
      son.pause();
    };
  }, [audio.url]);

  function basculer() {
    const son = element.current;
    if (!son) return;
    if (son.paused) {
      window.dispatchEvent(new CustomEvent(AUTRE_LECTURE, { detail: audio.url }));
      // La lecture peut être refusée (règles d'autoplay) : on ne laisse pas la
      // promesse se perdre, le bouton reprend simplement son état.
      son.play().catch(() => setJoue(false));
    } else {
      son.pause();
    }
  }

  const secondes = Math.round(audio.duree / 1000);
  // Rapportées au plus fort de l'enregistrement : sans ça, une note dite à bout
  // de bras donne une rangée de barres basses toutes pareilles.
  const barres = audio.niveaux.length
    ? ondeNormalisee(audio.niveaux)
    : Array.from({ length: 32 }, () => 30);

  return (
    <div className="flex items-center gap-3 border-t border-trait px-4 py-3">
      <button
        type="button"
        onClick={basculer}
        aria-label={joue ? `Arrêter la note vocale de ${nom}` : `Écouter la note vocale de ${nom}`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-95"
        style={{ background: `color-mix(in oklab, ${couleur} 18%, var(--surface))`, color: couleur }}
      >
        {joue ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M8 5.2v13.6a.8.8 0 0 0 1.22.68l11-6.8a.8.8 0 0 0 0-1.36l-11-6.8A.8.8 0 0 0 8 5.2Z" />
          </svg>
        )}
      </button>

      {/* La forme d'onde. Les barres déjà lues prennent la couleur de la
          personne ; le reste attend en gris. */}
      <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
        {barres.map((niveau, index) => {
          const lue = index / barres.length <= avancement;
          return (
            <span
              key={index}
              className="min-w-[2px] flex-1 rounded-full transition-[background-color]"
              style={{
                height: `${niveau}%`,
                background: lue ? couleur : "var(--surface-3)",
              }}
            />
          );
        })}
      </div>

      <span className="chiffres shrink-0 text-[12px] text-encre-3">
        {secondes}s
      </span>

      <audio
        ref={element}
        src={audio.url}
        preload="none"
        onPlay={() => setJoue(true)}
        onPause={() => setJoue(false)}
        onEnded={() => { setJoue(false); setAvancement(0); }}
        onTimeUpdate={(e) => {
          const son = e.currentTarget;
          if (son.duration && Number.isFinite(son.duration)) {
            setAvancement(son.currentTime / son.duration);
          }
        }}
      />
    </div>
  );
}
