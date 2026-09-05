"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, useTransition } from "react";

import { actionEnvoyerPhoto, actionRetirerPhoto } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import { RESSORT } from "@/lib/mouvement";
import type { Photo } from "@/lib/types";

/**
 * Les photos d'une journée.
 *
 * Chaque image est redimensionnée dans le navigateur avant d'être envoyée. Une
 * photo de téléphone pèse quatre méga-octets et mesure quatre mille pixels de
 * large ; la carte l'affiche sur trois cents. Envoyer l'originale, ce serait
 * faire payer à tout le monde — la connexion de celui qui envoie, la base qui
 * stocke, la connexion de ceux qui lisent — une résolution que personne ne
 * verra jamais.
 */
const COTE_MAX = 1200;
const QUALITE = 0.82;

/** Le même plafond que le serveur : refuser ici évite un aller-retour inutile. */
const MAX_PHOTOS = 4;

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

export function BoitePhoto({ photos }: { photos: Photo[] }) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const champ = useRef<HTMLInputElement>(null);
  const complet = photos.length >= MAX_PHOTOS;

  function choisir(fichiers: FileList | null) {
    if (!fichiers || fichiers.length === 0) return;
    // `multiple` laisse en choisir dix d'un coup ; on garde ce qui tient sous
    // le plafond plutôt que de refuser la sélection entière.
    const retenus = Array.from(fichiers).slice(0, MAX_PHOTOS - photos.length);

    demarrer(async () => {
      for (const fichier of retenus) {
        let reduite;
        try {
          reduite = await reduire(fichier);
        } catch {
          setEtat({ erreur: "Cette image n'a pas pu être lue." });
          continue;
        }
        const donnees = new FormData();
        donnees.set("photo", new File([reduite.blob], "journee.jpg", { type: "image/jpeg" }));
        donnees.set("largeur", String(reduite.largeur));
        donnees.set("hauteur", String(reduite.hauteur));
        const reponse = await actionEnvoyerPhoto(ETAT_INITIAL, donnees);
        // On s'arrête à la première erreur du serveur : les suivantes diraient
        // la même chose, et empiler quatre fois le même message n'aide personne.
        if (reponse.erreur) {
          setEtat(reponse);
          break;
        }
        setEtat(ETAT_INITIAL);
      }
      if (champ.current) champ.current.value = "";
    });
  }

  return (
    <div className="mt-3">
      {photos.length > 0 && (
        <ul className="mb-2 grid grid-cols-2 gap-2">
          <AnimatePresence initial={false}>
            {photos.map((photo) => (
              <motion.li
                key={photo.id}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={RESSORT.moyen}
                className="relative overflow-hidden rounded-2xl border border-trait"
              >
                {/* `unoptimized` : l'image est déjà redimensionnée et compressée,
                    et elle sort d'une route privée que l'optimiseur ne peut pas
                    relire. */}
                <Image
                  src={photo.url}
                  alt=""
                  width={photo.largeur || 1200}
                  height={photo.hauteur || 900}
                  unoptimized
                  className="aspect-square w-full object-cover"
                />
                <button
                  type="button"
                  disabled={enCours}
                  onClick={() => demarrer(async () => setEtat(await actionRetirerPhoto(photo.id)))}
                  aria-label="Retirer cette photo"
                  className="cible-tactile absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full text-[15px] leading-none text-white/90 backdrop-blur-sm transition active:scale-95"
                  style={{ background: "rgb(0 0 0 / 0.45)" }}
                >
                  ×
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <label
        className={`inline-block text-[13px] underline underline-offset-2 ${
          complet ? "cursor-default text-encre-3" : "cursor-pointer text-encre-2 hover:text-encre"
        }`}
      >
        <input
          ref={champ}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => choisir(e.target.files)}
          disabled={enCours || complet}
          className="sr-only"
        />
        {enCours
          ? "Envoi…"
          : complet
            ? `${MAX_PHOTOS} photos, c'est le maximum`
            : photos.length > 0
              ? "Ajouter une autre photo"
              : "Ajouter une photo"}
      </label>

      {etat.erreur && (
        <p role="alert" className="mt-1.5 text-[13px] text-encre-2">
          {etat.erreur}
        </p>
      )}
    </div>
  );
}
