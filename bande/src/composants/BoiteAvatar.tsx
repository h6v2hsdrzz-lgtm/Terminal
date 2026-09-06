"use client";

import { useRef, useState, useTransition } from "react";

import { actionEnvoyerAvatar, actionRetirerAvatar } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import type { Profil } from "@/lib/types";
import { Avatar } from "./Avatar";

/**
 * Choisir sa photo de profil, et la recadrer au doigt.
 *
 * Le recadrage tient en trois gestes : on déplace l'image sous une fenêtre
 * carrée, on règle le zoom, on garde. Un curseur plutôt qu'un pincement — le
 * pincement est plus élégant et beaucoup plus fragile, et il se fait à deux
 * doigts sur un téléphone qu'on tient d'une main. On pourra l'ajouter par
 * dessus le jour où celui-ci gêne.
 *
 * Tout se passe dans le navigateur : ce qui part au serveur est un carré de
 * 256 pixels en JPEG, quelques dizaines de kilo-octets. Envoyer l'originale
 * ferait stocker quatre méga-octets pour un rond de quarante pixels.
 */
const COTE = 256;
const QUALITE = 0.85;

export function BoiteAvatar({ profil }: { profil: Profil }) {
  const [source, setSource] = useState<{ image: ImageBitmap; url: string } | null>(null);
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const champ = useRef<HTMLInputElement>(null);

  async function choisir(fichier: File | undefined) {
    if (!fichier) return;
    setEtat(ETAT_INITIAL);
    try {
      // `imageOrientation` : sans ça, une photo prise en tenant le téléphone de
      // travers arrive couchée. L'attribut EXIF ne se voit pas dans un canevas.
      const image = await createImageBitmap(fichier, { imageOrientation: "from-image" });
      setSource({ image, url: URL.createObjectURL(fichier) });
    } catch {
      setEtat({ erreur: "Cette image n'a pas pu être lue." });
    }
    if (champ.current) champ.current.value = "";
  }

  function envoyer(blob: Blob) {
    demarrer(async () => {
      const donnees = new FormData();
      donnees.set("avatar", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
      const reponse = await actionEnvoyerAvatar(ETAT_INITIAL, donnees);
      setEtat(reponse);
      if (!reponse.erreur) fermer();
    });
  }

  function fermer() {
    if (source) {
      source.image.close();
      URL.revokeObjectURL(source.url);
    }
    setSource(null);
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar profil={profil} taille={64} anneau />

      <div className="min-w-0">
        <label className="cursor-pointer text-[13px] text-encre-2 underline underline-offset-2 hover:text-encre">
          <input
            ref={champ}
            type="file"
            accept="image/*"
            onChange={(e) => choisir(e.target.files?.[0])}
            disabled={enCours}
            className="sr-only"
          />
          {profil.avatar ? "Changer de photo" : "Mettre une photo"}
        </label>

        {profil.avatar && !enCours && (
          <button
            type="button"
            onClick={() => demarrer(async () => setEtat(await actionRetirerAvatar()))}
            className="ml-3 text-[13px] text-encre-3 underline underline-offset-2 hover:text-encre-2"
          >
            revenir aux initiales
          </button>
        )}

        {etat.erreur && (
          <p role="alert" className="mt-1.5 text-[13px] text-encre-2">
            {etat.erreur}
          </p>
        )}
      </div>

      {source && (
        <Recadrage
          image={source.image}
          url={source.url}
          enCours={enCours}
          annuler={fermer}
          garder={envoyer}
        />
      )}
    </div>
  );
}

/** La fenêtre carrée, l'image dessous, et deux gestes. */
function Recadrage({
  image,
  url,
  enCours,
  annuler,
  garder,
}: {
  image: ImageBitmap;
  url: string;
  enCours: boolean;
  annuler: () => void;
  garder: (blob: Blob) => void;
}) {
  // `echelle` vaut 1 quand l'image remplit tout juste la fenêtre : en dessous,
  // il resterait du vide dans le carré.
  const [echelle, setEchelle] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const fenetre = useRef<HTMLDivElement>(null);
  const depart = useRef<{ x: number; y: number } | null>(null);

  const couverture = Math.max(1, Math.min(image.width, image.height) / Math.min(image.width, image.height));
  const zoom = echelle * couverture;

  function borner(x: number, y: number, cote: number) {
    // On ne laisse jamais sortir l'image de la fenêtre : un carré à moitié vide
    // n'est pas un recadrage, c'est une erreur qu'on aurait laissé faire.
    const debord = (cote * (zoom * Math.max(image.width, image.height)) / Math.min(image.width, image.height) - cote) / 2;
    const max = Math.max(0, debord);
    return { x: Math.max(-max, Math.min(max, x)), y: Math.max(-max, Math.min(max, y)) };
  }

  function deplacer(e: React.PointerEvent) {
    if (!depart.current || !fenetre.current) return;
    const cote = fenetre.current.clientWidth;
    setPosition(borner(e.clientX - depart.current.x, e.clientY - depart.current.y, cote));
  }

  function decouper() {
    const toile = document.createElement("canvas");
    toile.width = COTE;
    toile.height = COTE;
    const ctx = toile.getContext("2d");
    if (!ctx) return;

    const cote = fenetre.current?.clientWidth ?? 1;
    // Ce que la fenêtre montre, ramené aux pixels de l'image d'origine.
    const affiche = Math.min(image.width, image.height) / zoom;
    const cx = image.width / 2 - (position.x / cote) * affiche * (image.width / Math.min(image.width, image.height));
    const cy = image.height / 2 - (position.y / cote) * affiche * (image.height / Math.min(image.width, image.height));

    ctx.drawImage(image, cx - affiche / 2, cy - affiche / 2, affiche, affiche, 0, 0, COTE, COTE);
    toile.toBlob((blob) => blob && garder(blob), "image/jpeg", QUALITE);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Recadrer la photo"
    >
      <div className="w-full max-w-sm rounded-3xl bg-surface p-4 zone-sure-basse">
        <p className="mb-3 text-[13px] text-encre-2">Fais glisser pour cadrer.</p>

        <div
          ref={fenetre}
          onPointerDown={(e) => {
            depart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={deplacer}
          onPointerUp={() => { depart.current = null; }}
          onPointerCancel={() => { depart.current = null; }}
          className="relative mx-auto aspect-square w-full max-w-[280px] cursor-grab touch-none overflow-hidden rounded-full bg-surface-2"
        >
          {/* Une balise <img> et non <Image> : la source est une adresse
              d'objet locale, que l'optimiseur de Next ne sait pas traiter. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            draggable={false}
            style={{
              transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${zoom})`,
              position: "absolute",
              left: "50%",
              top: "50%",
              minWidth: "100%",
              minHeight: "100%",
              maxWidth: "none",
            }}
          />
        </div>

        <label htmlFor="zoom" className="mt-4 block text-[13px] text-encre-2">Zoom</label>
        <input
          id="zoom"
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={echelle}
          onChange={(e) => {
            setEchelle(Number(e.target.value));
            setPosition({ x: 0, y: 0 });
          }}
          className="mt-1 w-full accent-[var(--encre)]"
        />

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={annuler}
            className="flex-1 rounded-[var(--radius-pilule)] border border-trait py-2.5 text-[14px] text-encre-2"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={decouper}
            disabled={enCours}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="flex-1 rounded-[var(--radius-pilule)] py-2.5 text-[14px] font-semibold disabled:opacity-50"
          >
            {enCours ? "…" : "Garder"}
          </button>
        </div>
      </div>
    </div>
  );
}
