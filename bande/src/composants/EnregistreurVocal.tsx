"use client";

import { useEffect, useRef, useState } from "react";
import { ondeNormalisee } from "@/lib/onde";

/**
 * L'enregistrement d'une note vocale de trente secondes.
 *
 * Trois choses que Safari impose, et qu'il vaut mieux traiter que découvrir :
 *
 * · **le format se choisit à l'exécution.** Safari produit du MP4/AAC, les
 *   autres du WebM/Opus. Coder un format en dur fait échouer l'enregistrement
 *   sur la moitié des téléphones — et sur l'iPhone en particulier, qui est la
 *   cible ;
 * · **le micro exige un vrai geste.** `getUserMedia` n'est appelé que dans le
 *   gestionnaire du bouton, jamais au montage ;
 * · **la piste doit être libérée.** Sans `stop()` sur chaque piste, l'indicateur
 *   orange de l'iPhone reste allumé après l'enregistrement, ce qui inquiète à
 *   juste titre.
 *
 * Les niveaux sont mesurés pendant l'enregistrement : la forme d'onde du fil
 * est donc celle de ce son-là, pas un décor.
 */
const DUREE_MAX = 30_000;
const BARRES = 48;

const FORMATS = [
  "audio/mp4",                 // Safari, iOS
  "audio/webm;codecs=opus",    // Chrome, Firefox
  "audio/webm",
  "audio/ogg;codecs=opus",
];

function formatDisponible(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f));
}

export type SonEnregistre = {
  blob: Blob;
  mime: string;
  duree: number;
  niveaux: number[];
};

export function EnregistreurVocal({
  onFini,
  desactive = false,
}: {
  onFini: (son: SonEnregistre) => void;
  desactive?: boolean;
}) {
  const [etat, setEtat] = useState<"repos" | "enregistre" | "refuse" | "impossible">("repos");
  const [ecoule, setEcoule] = useState(0);
  const [apercu, setApercu] = useState<number[]>([]);

  const enregistreur = useRef<MediaRecorder | null>(null);
  const piste = useRef<MediaStream | null>(null);
  const contexte = useRef<AudioContext | null>(null);
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null);
  const niveaux = useRef<number[]>([]);
  const debut = useRef(0);

  useEffect(() => () => nettoyer(), []);

  function nettoyer() {
    if (minuteur.current) clearInterval(minuteur.current);
    minuteur.current = null;
    // Sans ça, la pastille orange de l'iPhone reste allumée.
    piste.current?.getTracks().forEach((t) => t.stop());
    piste.current = null;
    contexte.current?.close().catch(() => {});
    contexte.current = null;
  }

  async function demarrer() {
    const mime = formatDisponible();
    if (!mime) { setEtat("impossible"); return; }

    let flux: MediaStream;
    try {
      flux = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Refus, ou pas de micro. On le dit une fois, sans insister.
      setEtat("refuse");
      return;
    }

    piste.current = flux;
    niveaux.current = [];
    setApercu([]);
    debut.current = Date.now();

    // La mesure des niveaux, pour la forme d'onde.
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    contexte.current = ctx;
    const analyseur = ctx.createAnalyser();
    analyseur.fftSize = 512;
    ctx.createMediaStreamSource(flux).connect(analyseur);
    const tampon = new Uint8Array(analyseur.frequencyBinCount);

    const enr = new MediaRecorder(flux, { mimeType: mime });
    enregistreur.current = enr;
    const morceaux: Blob[] = [];
    enr.ondataavailable = (e) => { if (e.data.size > 0) morceaux.push(e.data); };
    enr.onstop = () => {
      const duree = Math.min(Date.now() - debut.current, DUREE_MAX);
      nettoyer();
      setEtat("repos");
      setEcoule(0);
      if (morceaux.length === 0) return;
      onFini({
        blob: new Blob(morceaux, { type: mime }),
        mime,
        duree,
        niveaux: reduire(niveaux.current, BARRES),
      });
    };

    enr.start();
    setEtat("enregistre");

    minuteur.current = setInterval(() => {
      analyseur.getByteTimeDomainData(tampon);
      // Écart quadratique moyen autour du silence (128) : c'est le volume
      // perçu, pas une fréquence.
      let somme = 0;
      for (const v of tampon) somme += (v - 128) ** 2;
      const niveau = Math.min(100, Math.round(Math.sqrt(somme / tampon.length) * 3.2));
      niveaux.current.push(niveau);
      setApercu(reduire(niveaux.current, 32));

      const passe = Date.now() - debut.current;
      setEcoule(passe);
      if (passe >= DUREE_MAX) arreter();
    }, 90);
  }

  function arreter() {
    if (enregistreur.current?.state === "recording") enregistreur.current.stop();
    else { nettoyer(); setEtat("repos"); }
  }

  if (etat === "impossible") {
    return (
      <p className="text-[13px] leading-snug text-encre-3">
        Ce navigateur ne sait pas enregistrer de son. La note écrite fait très
        bien l&apos;affaire.
      </p>
    );
  }

  if (etat === "refuse") {
    return (
      <p role="status" className="text-[13px] leading-snug text-encre-3">
        Micro refusé. Tu peux l&apos;autoriser dans les réglages de ton navigateur —
        ou t&apos;en tenir à l&apos;écrit, c&apos;est très bien aussi.
      </p>
    );
  }

  const restant = Math.max(0, Math.ceil((DUREE_MAX - ecoule) / 1000));

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={etat === "enregistre" ? arreter : demarrer}
        disabled={desactive}
        aria-label={etat === "enregistre" ? "Arrêter l'enregistrement" : "Enregistrer une note vocale"}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border transition active:scale-95 disabled:opacity-40"
        style={
          etat === "enregistre"
            ? { background: "var(--encre)", color: "var(--surface)", borderColor: "var(--encre)" }
            : { borderColor: "var(--trait-fort)", background: "var(--surface)" }
        }
      >
        {etat === "enregistre" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="5" y="5" width="14" height="14" rx="2.5" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        )}
      </button>

      {etat === "enregistre" ? (
        <>
          <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
            {/* La même mise à l'échelle qu'au lecteur : ce qu'on voit pendant
                l'enregistrement doit être ce qu'on retrouvera après. */}
            {ondeNormalisee(apercu).map((niveau, i) => (
              <span
                key={i}
                className="min-w-[2px] flex-1 rounded-full"
                style={{ height: `${niveau}%`, background: "var(--joie-encre)" }}
              />
            ))}
          </div>
          <span className="chiffres shrink-0 text-[13px] text-encre-2">{restant}s</span>
        </>
      ) : (
        <span className="text-[13px] text-encre-3">
          Ou dis-le — 30 secondes, en plus de l&apos;écrit.
        </span>
      )}
    </div>
  );
}

/** Ramène une série de mesures à un nombre fixe de barres, par moyennes. */
function reduire(source: number[], combien: number): number[] {
  if (source.length === 0) return [];
  if (source.length <= combien) return [...source];
  const pas = source.length / combien;
  return Array.from({ length: combien }, (_, i) => {
    const tranche = source.slice(Math.floor(i * pas), Math.max(Math.floor((i + 1) * pas), Math.floor(i * pas) + 1));
    return Math.round(tranche.reduce((s, v) => s + v, 0) / tranche.length);
  });
}
