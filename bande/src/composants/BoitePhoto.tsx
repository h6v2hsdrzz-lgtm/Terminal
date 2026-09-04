"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";

import { actionEnvoyerPhoto, actionRetirerPhoto } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";

/**
 * Une photo sur sa journée.
 *
 * L'image est redimensionnée dans le navigateur avant d'être envoyée. Une photo
 * de téléphone pèse quatre méga-octets et mesure quatre mille pixels de large ;
 * la carte l'affiche sur trois cents. Envoyer l'originale, ce serait faire payer
 * à tout le monde — la connexion de celui qui envoie, la base qui stocke, la
 * connexion de ceux qui lisent — une résolution que personne ne verra jamais.
 */
const COTE_MAX = 1200;
const QUALITE = 0.82;

async function reduire(fichier: File): Promise<{ blob: Blob; largeur: number; hauteur: number }> {
  // `createImageBitmap` décode hors du fil principal et respecte l'orientation
  // EXIF, ce qu'une balise <img> ne fait pas de façon fiable.
  const image = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  const facteur = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
  const largeur = Math.round(image.width * facteur);
  const hauteur = Math.round(image.height * facteur);

  const toile = document.createElement("canvas");
  toile.width = largeur;
  toile.height = hauteur;
  const contexte = toile.getContext("2d");
  if (!contexte) throw new Error("toile indisponible");
  contexte.drawImage(image, 0, 0, largeur, hauteur);
  image.close();

  const blob = await new Promise<Blob | null>((resoudre) =>
    toile.toBlob(resoudre, "image/jpeg", QUALITE),
  );
  if (!blob) throw new Error("compression impossible");
  return { blob, largeur, hauteur };
}

export function BoitePhoto({ photo }: { photo: string | null }) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const champ = useRef<HTMLInputElement>(null);

  function choisir(fichier: File | undefined) {
    if (!fichier) return;
    demarrer(async () => {
      let reduite;
      try {
        reduite = await reduire(fichier);
      } catch {
        setEtat({ erreur: "Cette image n'a pas pu être lue." });
        return;
      }
      const donnees = new FormData();
      donnees.set("photo", new File([reduite.blob], "journee.jpg", { type: "image/jpeg" }));
      donnees.set("largeur", String(reduite.largeur));
      donnees.set("hauteur", String(reduite.hauteur));
      setEtat(await actionEnvoyerPhoto(ETAT_INITIAL, donnees));
      if (champ.current) champ.current.value = "";
    });
  }

  return (
    <div className="mt-3">
      {photo && (
        <div className="relative mb-2 overflow-hidden rounded-2xl border border-trait">
          {/* `unoptimized` : l'image est déjà redimensionnée et compressée, et
              elle sort d'une route privée que l'optimiseur ne peut pas relire. */}
          <Image
            src={photo}
            alt="La photo de ta journée"
            width={1200}
            height={900}
            unoptimized
            className="h-auto w-full"
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="cursor-pointer text-[13px] text-encre-2 underline underline-offset-2 hover:text-encre">
          <input
            ref={champ}
            type="file"
            accept="image/*"
            onChange={(e) => choisir(e.target.files?.[0])}
            disabled={enCours}
            className="sr-only"
          />
          {enCours ? "Envoi…" : photo ? "Remplacer la photo" : "Ajouter une photo"}
        </label>

        {photo && !enCours && (
          <button
            type="button"
            onClick={() => demarrer(async () => setEtat(await actionRetirerPhoto()))}
            className="text-[13px] text-encre-3 underline underline-offset-2 hover:text-encre-2"
          >
            retirer
          </button>
        )}
      </div>

      {etat.erreur && (
        <p role="alert" className="mt-1.5 text-[13px] text-encre-2">
          {etat.erreur}
        </p>
      )}
    </div>
  );
}
