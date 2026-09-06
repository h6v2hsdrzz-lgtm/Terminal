"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, useTransition } from "react";

import { actionEnvoyerPhoto, actionLegender, actionRetirerPhoto } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import { RESSORT } from "@/lib/mouvement";
import { LONGUEUR_LEGENDE, MAX_MEDIAS, enSecondes } from "@/lib/media";
import { ErreurTranscodage, preparerMedia } from "@/lib/transcodage";
import type { Media } from "@/lib/types";

/**
 * Les photos et les vidéos d'une journée.
 *
 * Tout est réduit dans le navigateur avant l'envoi. Une photo de téléphone pèse
 * quatre méga-octets, une vidéo de huit secondes une quinzaine ; la carte les
 * affiche sur trois cents pixels. Envoyer les originaux, ce serait faire payer à
 * tout le monde — la connexion de celui qui envoie, la base qui stocke, la
 * connexion de ceux qui lisent — une résolution que personne ne verra jamais.
 *
 * Le réencodage d'une vidéo prend le temps de la lire : on ne décode pas plus
 * vite que le navigateur ne joue. D'où la barre d'avancement — sans elle,
 * l'écran a l'air figé pendant huit secondes.
 */
export function BoiteMedias({ medias }: { medias: Media[] }) {
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const [part, setPart] = useState<number | null>(null);
  const [legende, setLegende] = useState<Media | null>(null);
  const champ = useRef<HTMLInputElement>(null);
  const appareil = useRef<HTMLInputElement>(null);
  const complet = medias.length >= MAX_MEDIAS;

  function choisir(fichiers: FileList | null) {
    if (!fichiers || fichiers.length === 0) return;
    // Le retour haptique arrive à la SÉLECTION, pas au toucher du bouton :
    // vibrer sous un doigt qui a seulement ouvert un sélecteur dit que quelque
    // chose est arrivé alors que rien n'est arrivé. Absent sur iOS, d'où le
    // test — c'est un bonus sur Android, jamais une promesse.
    if ("vibrate" in navigator) navigator.vibrate(12);
    // On garde ce qui tient sous le plafond plutôt que de refuser la sélection
    // entière : quelqu'un qui en choisit dix en veut visiblement plusieurs.
    const retenus = Array.from(fichiers).slice(0, MAX_MEDIAS - medias.length);

    demarrer(async () => {
      for (const fichier of retenus) {
        let pret;
        try {
          setPart(fichier.type.startsWith("video/") ? 0 : null);
          pret = await preparerMedia(fichier, setPart);
        } catch (erreur) {
          // La cause exacte va dans la console : le message affiché est écrit
          // pour être lu par quelqu'un qui poste une photo, pas pour être
          // débogué. Sans cette trace, un échec ne laisse aucune prise.
          console.error("préparation du média", erreur);
          // Les erreurs de transcodage sont écrites pour être lues ; les autres
          // ne diraient rien à personne.
          setEtat({
            erreur:
              erreur instanceof ErreurTranscodage
                ? erreur.message
                : fichier.type.startsWith("video/")
                  ? "Cette vidéo n'a pas pu être lue."
                  : "Cette image n'a pas pu être lue.",
          });
          continue;
        } finally {
          setPart(null);
        }

        const donnees = new FormData();
        const extension = pret.genre === "video" ? "mp4" : "jpg";
        donnees.set("media", new File([pret.blob], `journee.${extension}`, { type: pret.blob.type }));
        donnees.set("genre", pret.genre);
        donnees.set("largeur", String(pret.largeur));
        donnees.set("hauteur", String(pret.hauteur));
        if (pret.duree !== null) donnees.set("duree", String(pret.duree));
        if (pret.vignette) {
          donnees.set("vignette", new File([pret.vignette], "vignette.jpg", { type: "image/jpeg" }));
        }

        const reponse = await actionEnvoyerPhoto(ETAT_INITIAL, donnees);
        // On s'arrête à la première erreur du serveur : les suivantes diraient
        // la même chose, et empiler six fois le même message n'aide personne.
        if (reponse.erreur) {
          setEtat(reponse);
          break;
        }
        setEtat(ETAT_INITIAL);
      }
      // Les deux champs se vident : sinon, reprendre la même photo deux fois
      // de suite ne déclenche aucun changement et n'envoie rien.
      if (champ.current) champ.current.value = "";
      if (appareil.current) appareil.current.value = "";
    });
  }

  return (
    <div className="mt-3">
      {medias.length > 0 && (
        <ul className="mb-2 grid grid-cols-3 gap-2">
          <AnimatePresence initial={false}>
            {medias.map((media) => (
              <motion.li
                key={media.id}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={RESSORT.moyen}
                className="relative overflow-hidden rounded-xl border border-trait"
              >
                {/* La vignette, pas l'original : dans une case de cent pixels,
                    l'original ferait payer une résolution invisible — et pour
                    une vidéo, le fichier entier. */}
                <Image
                  src={media.vignette}
                  alt={media.legende ?? ""}
                  width={400}
                  height={400}
                  unoptimized
                  className="aspect-square w-full object-cover"
                />

                {media.genre === "video" && (
                  <span
                    className="pointer-events-none absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-white"
                    style={{ background: "rgb(0 0 0 / 0.5)" }}
                  >
                    ▶ {media.duree ? enSecondes(media.duree) : "vidéo"}
                  </span>
                )}

                <div className="absolute right-1 top-1 flex gap-1">
                  <button
                    type="button"
                    disabled={enCours}
                    onClick={() => setLegende(media)}
                    aria-label="Légender"
                    className="cible-tactile grid h-7 w-7 place-items-center rounded-full text-[12px] text-white/90 backdrop-blur-sm transition active:scale-95"
                    style={{ background: "rgb(0 0 0 / 0.45)" }}
                  >
                    {media.legende ? "✎" : "+"}
                  </button>
                  <button
                    type="button"
                    disabled={enCours}
                    onClick={() => demarrer(async () => setEtat(await actionRetirerPhoto(media.id)))}
                    aria-label="Retirer"
                    className="cible-tactile grid h-7 w-7 place-items-center rounded-full text-[14px] leading-none text-white/90 backdrop-blur-sm transition active:scale-95"
                    style={{ background: "rgb(0 0 0 / 0.45)" }}
                  >
                    ×
                  </button>
                </div>

                {media.legende && (
                  <p className="truncate px-1.5 py-1 text-[11px] text-encre-2">{media.legende}</p>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {part !== null && (
        <div className="mb-2" role="status" aria-live="polite">
          <div className="h-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${Math.round(part * 100)}%`, background: "var(--encre)" }}
            />
          </div>
          <p className="mt-1 text-[12px] text-encre-3">
            La vidéo est réduite sur ton téléphone — ça prend le temps de la lire.
          </p>
        </div>
      )}

      {/**
        * Deux boutons, la caméra d'abord.
        *
        * Deux entrées distinctes, et pas un attribut ajouté à l'existante : sur
        * iPhone, `capture` ouvre l'appareil photo ET FERME la pellicule. Une
        * seule commande obligerait à choisir entre les deux pour tout le monde,
        * alors que ce sont deux gestes différents — prendre maintenant, ou
        * retrouver ce qu'on a pris tout à l'heure.
        *
        * La caméra est à GAUCHE, donc lue en premier : dans une application de
        * journal, on photographie sa journée bien plus souvent qu'on ne
        * retrouve une image d'hier.
        *
        * Une fois un média posé, les deux pavés se rétractent en une seule
        * ligne discrète : la bande de vignettes juste au-dessus devient le
        * sujet de l'écran, et deux grands boutons au-dessous la concurrenceraient.
        */}
      {complet ? (
        <p className="text-[13px] text-encre-3">
          {MAX_MEDIAS} médias, c&apos;est le maximum.
        </p>
      ) : medias.length > 0 ? (
        <div className="flex items-center gap-4">
          <label className="cible-tactile inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-encre-2 underline underline-offset-2">
            <input
              ref={appareil}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              onChange={(e) => choisir(e.target.files)}
              disabled={enCours}
              className="sr-only"
            />
            <IconeAppareil />
            {enCours ? "Envoi…" : "Photo"}
          </label>
          <label className="cible-tactile inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-encre-2 underline underline-offset-2">
            <input
              ref={champ}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => choisir(e.target.files)}
              disabled={enCours}
              className="sr-only"
            />
            <IconeGalerie />
            Galerie
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <PaveMedia
            libelle={enCours ? "Envoi…" : "Photo"}
            icone={<IconeAppareil />}
            desactive={enCours}
          >
            <input
              ref={appareil}
              type="file"
              accept="image/*,video/*"
              // `environment` : l'appareil arrière. Sans valeur, iOS choisit
              // parfois la caméra avant, ce qui n'est jamais ce qu'on veut
              // pour illustrer sa journée.
              capture="environment"
              onChange={(e) => choisir(e.target.files)}
              disabled={enCours}
              className="sr-only"
            />
          </PaveMedia>
          <PaveMedia libelle="Galerie" icone={<IconeGalerie />} desactive={enCours}>
            <input
              ref={champ}
              type="file"
              // Les deux formats d'un coup : le sélecteur propose alors la
              // pellicule entière plutôt que de forcer un choix en amont.
              accept="image/*,video/*"
              multiple
              onChange={(e) => choisir(e.target.files)}
              disabled={enCours}
              className="sr-only"
            />
          </PaveMedia>
        </div>
      )}

      {etat.erreur && (
        <p role="alert" className="mt-1.5 text-[13px] text-encre-2">
          {etat.erreur}
        </p>
      )}

      {legende && (
        <DialogueLegende
          media={legende}
          fermer={() => setLegende(null)}
          enregistrer={(texte) =>
            demarrer(async () => {
              setEtat(await actionLegender(legende.id, texte));
              setLegende(null);
            })
          }
        />
      )}
    </div>
  );
}

/** Deux mots sous l'image : ce qui fait qu'on la comprendra dans un an. */
function DialogueLegende({
  media,
  fermer,
  enregistrer,
}: {
  media: Media;
  fermer: () => void;
  enregistrer: (texte: string) => void;
}) {
  const [texte, setTexte] = useState(media.legende ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Légender"
      onClick={fermer}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-surface p-4 zone-sure-basse"
        onClick={(e) => e.stopPropagation()}
      >
        <label htmlFor="legende" className="mb-2 block text-[13px] text-encre-2">
          Deux mots sous cette {media.genre === "video" ? "vidéo" : "photo"}
        </label>
        <input
          id="legende"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          maxLength={LONGUEUR_LEGENDE}
          autoFocus
          placeholder="Facultatif"
          className="champ-saisie w-full rounded-2xl border border-trait bg-surface-2 px-3.5 py-3 placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={fermer}
            className="flex-1 rounded-[var(--radius-pilule)] border border-trait py-2.5 text-[14px] text-encre-2"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => enregistrer(texte)}
            style={{ background: "var(--encre)", color: "var(--surface)" }}
            className="flex-1 rounded-[var(--radius-pilule)] py-2.5 text-[14px] font-semibold"
          >
            Garder
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Un pavé média : 52 px de haut, moitié de la largeur, icône et libellé court.
 *
 * C'est un `<label>` et pas un `<button>`, parce que le champ de fichier vit
 * dedans : un bouton devrait le déclencher au clavier ET à la souris, et la
 * plupart des façons de le faire cassent l'ouverture du sélecteur sur iOS.
 * Le `label` la donne gratuitement.
 *
 * `active:scale-[0.97]` plutôt qu'un changement de couleur : sur un écran
 * tactile il n'y a pas de survol, et l'état pressé est le seul retour visuel
 * qu'on ait avant que le sélecteur ne s'ouvre. Le retour haptique, lui, est
 * déclenché à la sélection d'un fichier — vibrer au toucher d'un bouton qui
 * n'a encore rien fait dit quelque chose de faux.
 */
function PaveMedia({
  libelle,
  icone,
  desactive,
  children,
}: {
  libelle: string;
  icone: React.ReactNode;
  desactive: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex h-[52px] items-center justify-center gap-2 rounded-[var(--radius-carte)] border border-trait bg-surface-2 text-[15px] font-semibold transition active:scale-[0.97] ${
        desactive ? "cursor-default opacity-50" : "cursor-pointer"
      }`}
    >
      {children}
      <span aria-hidden className="text-encre-2">{icone}</span>
      <span>{libelle}</span>
    </label>
  );
}

/* Deux tracés, comme les icônes de la barre d'onglets : une bibliothèque pour
   ça pèserait plus que le reste de l'écran. */
function IconeAppareil() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8.5h3l1.4-2h7.2L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5Z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </svg>
  );
}

function IconeGalerie() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.4" />
      <circle cx="8.6" cy="10" r="1.5" />
      <path d="M3.8 17.2 8.4 12.8l3 2.7 3.6-3.9 4.2 4.6" />
    </svg>
  );
}
