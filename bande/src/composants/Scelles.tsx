"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";

import { Carte, TitreSection } from "./Carte";
import { MessageErreur, styleChamp } from "./Champ";
import { EnregistreurVocal, type SonEnregistre } from "./EnregistreurVocal";
import { actionEcrireCapsule, actionSupprimerCapsule } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";
import { decaler, enTexteLongAvecAnnee } from "@/lib/dates";
import { decompte, nomDuGenre } from "@/lib/scelle";
import { ErreurTranscodage, preparerScelle } from "@/lib/transcodage";
import type { Capsule, GenreScelle } from "@/lib/depot";

/**
 * Les scellés : un mot, une photo, une vidéo ou une voix, fermés jusqu'à une
 * date choisie.
 *
 * Ce qui est scellé ne quitte jamais le serveur. Le cacher côté client
 * reviendrait à l'envoyer et à demander poliment de ne pas regarder — ce qui
 * n'est pas la même chose, et se contourne d'un clic droit. L'aperçu, lui, est
 * flouté DANS SES OCTETS : réduit à trente-deux pixels avant l'envoi. On voit
 * qu'il y a quelque chose, on ne voit pas quoi.
 *
 * Ce n'est pas du chiffrement pour autant : le contenu est lisible en base par
 * qui l'administre. C'est une convention entre amis, et le README le dit.
 */
const DELAI_MIN = 7;
const LONGUEUR_MAX = 1000;

export const GENRES: { cle: GenreScelle; nom: string; aide: string }[] = [
  { cle: "mot", nom: "Un mot", aide: "Ce que tu veux relire plus tard." },
  { cle: "photo", nom: "Une photo", aide: "Elle restera floue jusqu'au jour dit." },
  { cle: "video", nom: "Une vidéo", aide: "Huit secondes, comme partout ailleurs." },
  { cle: "audio", nom: "Une voix", aide: "Trente secondes, à réécouter plus tard." },
];

export function Scelles({
  capsules,
  aujourdhui,
  moi,
}: {
  capsules: Capsule[];
  aujourdhui: string;
  moi: string;
}) {
  const [ouvertFormulaire, setOuvertFormulaire] = useState(false);

  const ouvertes = capsules.filter((c) => c.ouvrirLe <= aujourdhui);
  const scellees = capsules.filter((c) => c.ouvrirLe > aujourdhui);

  return (
    <section id="scelles" className="mt-7 scroll-mt-4">
      <TitreSection
        action={
          !ouvertFormulaire && (
            <button
              type="button"
              onClick={() => setOuvertFormulaire(true)}
              className="text-[13px] text-encre-2 underline underline-offset-2 hover:text-encre"
            >
              en sceller un
            </button>
          )
        }
      >
        Scellés
      </TitreSection>

      {ouvertFormulaire && (
        <FormulaireScelle
          aujourdhui={aujourdhui}
          fermer={() => setOuvertFormulaire(false)}
        />
      )}

      {ouvertes.length === 0 && scellees.length === 0 && !ouvertFormulaire && (
        <Carte className="p-5">
          <p className="text-[14px] leading-snug text-encre-2">
            Rien de scellé. Un mot, une photo, une vidéo ou une voix, fermés
            jusqu&apos;à une date que tu choisis — et qui s&apos;ouvrent devant
            tout le monde ce jour-là.
          </p>
        </Carte>
      )}

      {scellees.length > 0 && (
        <ul className="mt-3 space-y-2">
          {scellees.map((c) => (
            <li key={c.id}>
              <Sablier capsule={c} aujourdhui={aujourdhui} />
            </li>
          ))}
        </ul>
      )}

      {ouvertes.length > 0 && (
        <ul className="mt-3 space-y-3">
          {ouvertes.map((c) => (
            <li key={c.id}>
              <ScelleOuvert capsule={c} moi={moi} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Un scellé fermé : le sablier, l'aperçu flouté, le décompte.
 *
 * Il ne prend qu'une ligne. L'espace vertical du fil et des souvenirs est
 * précieux, et un scellé n'est pas encore un souvenir — c'est une promesse.
 */
export function Sablier({ capsule, aujourdhui }: { capsule: Capsule; aujourdhui: string }) {
  return (
    <Carte className="flex items-center gap-3 p-3">
      <span
        aria-hidden
        className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 text-[18px]"
      >
        {capsule.apercu ? (
          // Les octets sont déjà illisibles : trente-deux pixels de côté. Le
          // `blur` qui suit n'est qu'un adoucissement, il ne cache rien qui ne
          // le soit déjà.
          <Image
            src={capsule.apercu}
            alt=""
            width={32}
            height={32}
            unoptimized
            className="h-full w-full object-cover blur-[2px]"
          />
        ) : (
          "⏳"
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">
          {capsule.mienne ? "Tu as scellé" : `${capsule.auteur} a scellé`} {nomDuGenre(capsule.genre)}
        </p>
        <p className="text-[13px] text-encre-3">
          S&apos;ouvre {decompte(capsule.ouvrirLe, aujourdhui)} ·{" "}
          {enTexteLongAvecAnnee(capsule.ouvrirLe, aujourdhui)}
        </p>
      </div>
    </Carte>
  );
}

/** Un scellé dont le jour est venu. */
function ScelleOuvert({ capsule, moi }: { capsule: Capsule; moi: string }) {
  const [enCours, demarrer] = useTransition();

  return (
    <Carte className="overflow-hidden">
      {capsule.url && capsule.genre === "photo" && (
        <Image src={capsule.url} alt="" width={1400} height={1400} unoptimized className="h-auto w-full" />
      )}
      {capsule.url && capsule.genre === "video" && (
        <video src={capsule.url} poster={capsule.apercu ?? undefined} controls playsInline className="w-full" />
      )}
      {capsule.url && capsule.genre === "audio" && (
        <audio src={capsule.url} controls className="w-full p-3" />
      )}

      <div className="p-4">
        <p className="text-[12px] uppercase tracking-[0.08em] text-encre-3">
          Scellé le {enTexteLongAvecAnnee(capsule.creeLe, capsule.ouvrirLe)} par{" "}
          {capsule.mienne ? "toi" : capsule.auteur}
        </p>
        {capsule.texte && (
          <p className="mt-1.5 text-[15px] leading-snug whitespace-pre-wrap">{capsule.texte}</p>
        )}
        {capsule.auteurId === moi && (
          <button
            type="button"
            disabled={enCours}
            onClick={() => demarrer(async () => { await actionSupprimerCapsule(capsule.id); })}
            className="mt-2 text-[13px] text-encre-3 underline underline-offset-2 hover:text-encre-2"
          >
            le retirer
          </button>
        )}
      </div>
    </Carte>
  );
}

/** Sceller quelque chose : le genre, le contenu, le mot, la date. */
export function FormulaireScelle({
  aujourdhui,
  fermer,
  genreInitial = "mot",
}: {
  aujourdhui: string;
  fermer: () => void;
  /** Le genre choisi dans la feuille, pour ne pas le redemander. */
  genreInitial?: GenreScelle;
}) {
  const [genre, setGenre] = useState<GenreScelle>(genreInitial);
  const [texte, setTexte] = useState("");
  const [quand, setQuand] = useState(decaler(aujourdhui, 365));
  const [etat, setEtat] = useState(ETAT_INITIAL);
  const [enCours, demarrer] = useTransition();
  const [part, setPart] = useState<number | null>(null);
  const [pret, setPret] = useState<{ blob: Blob; apercu: Blob | null; duree: number | null } | null>(null);
  const champ = useRef<HTMLInputElement>(null);

  const choisi = GENRES.find((g) => g.cle === genre)!;

  async function choisirFichier(fichier: File | undefined) {
    if (!fichier) return;
    setEtat(ETAT_INITIAL);
    try {
      setPart(fichier.type.startsWith("video/") ? 0 : null);
      const resultat = await preparerScelle(fichier, setPart);
      setPret({ blob: resultat.blob, apercu: resultat.apercu, duree: resultat.duree });
    } catch (erreur) {
      setEtat({
        erreur: erreur instanceof ErreurTranscodage ? erreur.message : "Ce fichier n'a pas pu être lu.",
      });
    } finally {
      setPart(null);
      if (champ.current) champ.current.value = "";
    }
  }

  function envoyer() {
    demarrer(async () => {
      const donnees = new FormData();
      donnees.set("texte", texte);
      donnees.set("ouvrirLe", quand);
      donnees.set("genre", genre);
      if (genre !== "mot" && pret) {
        const extension = genre === "photo" ? "jpg" : genre === "video" ? "mp4" : "audio";
        donnees.set("contenu", new File([pret.blob], `scelle.${extension}`, { type: pret.blob.type }));
        if (pret.apercu) donnees.set("apercu", new File([pret.apercu], "apercu.jpg", { type: "image/jpeg" }));
        if (pret.duree !== null) donnees.set("duree", String(pret.duree));
      }
      const reponse = await actionEcrireCapsule(ETAT_INITIAL, donnees);
      setEtat(reponse);
      if (!reponse.erreur) fermer();
    });
  }

  const manque = genre !== "mot" && !pret;

  return (
    <Carte className="p-4">
      <fieldset>
        <legend className="mb-2 text-[13px] text-encre-2">Qu&apos;est-ce que tu scelles ?</legend>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => (
            <button
              key={g.cle}
              type="button"
              onClick={() => { setGenre(g.cle); setPret(null); }}
              aria-pressed={genre === g.cle}
              className={`cible-tactile rounded-[var(--radius-pilule)] border px-3 py-1.5 text-[13px] transition ${
                genre === g.cle
                  ? "border-transparent font-medium"
                  : "border-trait text-encre-2 hover:border-trait-fort"
              }`}
              style={genre === g.cle ? { background: "var(--encre)", color: "var(--surface)" } : undefined}
            >
              {g.nom}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-encre-3">{choisi.aide}</p>
      </fieldset>

      {(genre === "photo" || genre === "video") && (
        <div className="mt-3">
          <label className="cursor-pointer text-[13px] text-encre-2 underline underline-offset-2">
            <input
              ref={champ}
              type="file"
              accept={genre === "video" ? "video/*" : "image/*"}
              onChange={(e) => choisirFichier(e.target.files?.[0])}
              className="sr-only"
            />
            {pret ? "Changer" : `Choisir ${genre === "video" ? "une vidéo" : "une photo"}`}
          </label>
          {pret && <span className="ml-3 text-[13px] text-encre-3">c&apos;est prêt</span>}
          {part !== null && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${Math.round(part * 100)}%`, background: "var(--encre)" }} />
            </div>
          )}
        </div>
      )}

      {genre === "audio" && !pret && (
        <div className="mt-3">
          <EnregistreurVocal
            onFini={(son: SonEnregistre) =>
              setPret({ blob: son.blob, apercu: null, duree: son.duree })
            }
          />
        </div>
      )}
      {genre === "audio" && pret && (
        <p className="mt-3 text-[13px] text-encre-3">La voix est enregistrée.</p>
      )}

      <label htmlFor="texte-scelle" className="mt-4 mb-1.5 block text-[13px] text-encre-2">
        {genre === "mot" ? "Le mot" : "Un mot pour aller avec"}
      </label>
      <textarea
        id="texte-scelle"
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={genre === "mot" ? 4 : 2}
        maxLength={LONGUEUR_MAX}
        placeholder={genre === "mot" ? "Où tu en es aujourd'hui…" : "Ce que tu veux dire en l'ouvrant…"}
        className="champ-saisie w-full resize-none rounded-2xl border border-trait bg-surface-2 px-3.5 py-3 placeholder:text-encre-3 focus:border-trait-fort focus:outline-none"
      />

      <label htmlFor="ouvrir-le" className="mt-3 mb-1.5 block text-[13px] text-encre-2">
        À ouvrir le
      </label>
      <input
        id="ouvrir-le"
        type="date"
        value={quand}
        min={decaler(aujourdhui, DELAI_MIN)}
        onChange={(e) => setQuand(e.target.value)}
        className={styleChamp}
      />
      <p className="mt-1 text-[12px] text-encre-3">
        Au moins {DELAI_MIN} jours — sinon ce n&apos;est pas un scellé. Il
        s&apos;ouvrira {decompte(quand, aujourdhui)}.
      </p>

      {etat.erreur && <div className="mt-3"><MessageErreur>{etat.erreur}</MessageErreur></div>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={fermer}
          className="flex-1 rounded-[var(--radius-pilule)] border border-trait py-2.5 text-[14px] text-encre-2"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={envoyer}
          disabled={enCours || manque || !texte.trim()}
          style={{ background: "var(--encre)", color: "var(--surface)" }}
          className="flex-1 rounded-[var(--radius-pilule)] py-2.5 text-[14px] font-semibold disabled:opacity-40"
        >
          {enCours ? "…" : "Sceller"}
        </button>
      </div>
    </Carte>
  );
}
