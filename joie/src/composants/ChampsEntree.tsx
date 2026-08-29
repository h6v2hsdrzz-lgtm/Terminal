"use client";

import { Baby, Leaf } from "lucide-react";
import { useId } from "react";

import {
  COULEURS_PERSONNES,
  DECLENCHEURS,
  JOIE_MAX,
  JOIE_MIN,
  PERSONNES,
  type Personne,
} from "@/lib/constantes";
import { aujourdhuiIso, isoVersFr } from "@/lib/date";
import type { SaisieEntree } from "@/lib/types";
import { NOTES_MAX, type Champ } from "@/lib/validation";

import { Bascule } from "./ui/Bascule";
import { Segments } from "./ui/Segments";

/**
 * Les champs d'une entrée, sans logique d'enregistrement : le formulaire de
 * saisie rapide et la fenêtre de modification affichent exactement la même
 * chose, ce qui évite qu'ils divergent.
 */

/** Le ton du curseur suit le score : rouge en bas, ambre au milieu, vert en haut. */
export function couleurJoie(joie: number): string {
  if (joie <= 3) return "var(--rouge)";
  if (joie <= 6) return "var(--ambre)";
  return "var(--vert)";
}

const VISAGES = ["😞", "😔", "😕", "😐", "🙂", "😊", "😄", "😁", "🤩", "🥳"];

export function libelleJoie(joie: number): string {
  if (joie <= 2) return "Journée difficile";
  if (joie <= 4) return "En demi-teinte";
  if (joie <= 6) return "Correcte";
  if (joie <= 8) return "Bonne journée";
  return "Excellente journée";
}

export function ChampsEntree({
  valeur,
  onChange,
  erreurs = {},
  idPrefixe,
}: {
  valeur: SaisieEntree;
  onChange: (valeur: SaisieEntree) => void;
  erreurs?: Partial<Record<Champ, string>>;
  idPrefixe?: string;
}) {
  const idAuto = useId();
  const prefixe = idPrefixe ?? idAuto;
  const accent = couleurJoie(valeur.joie);
  const remplissage = ((valeur.joie - JOIE_MIN) / (JOIE_MAX - JOIE_MIN)) * 100;

  const modifier = <C extends keyof SaisieEntree>(champ: C, v: SaisieEntree[C]) =>
    onChange({ ...valeur, [champ]: v });

  return (
    <div className="space-y-5">
      {/* ── Date ─────────────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor={`${prefixe}-date`}
          className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-attenue"
        >
          Date
        </label>
        <input
          id={`${prefixe}-date`}
          type="date"
          value={valeur.date}
          // « Aujourd'hui » en heure locale : `toISOString()` renvoie la date
          // UTC, et interdirait la saisie du jour en soirée à l'est de Greenwich.
          max={aujourdhuiIso()}
          onChange={(e) => modifier("date", e.target.value)}
          aria-invalid={Boolean(erreurs.date)}
          className="w-full rounded-xl border border-bordure bg-surface px-3 py-2 text-sm tabulaire transition focus:border-ardoise"
        />
        <p className="mt-1 text-xs text-faible">
          {valeur.date ? isoVersFr(valeur.date) : "—"}
          {erreurs.date && <span className="ml-2 text-rouge">{erreurs.date}</span>}
        </p>
      </div>

      {/* ── Profil ───────────────────────────────────────────────────── */}
      <div>
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-attenue">
          Profil
        </span>
        <Segments
          etiquette="Personne"
          valeur={valeur.personne}
          onChange={(personne: Personne) => modifier("personne", personne)}
          segments={PERSONNES.map((personne) => ({
            valeur: personne,
            libelle: personne,
            couleur: COULEURS_PERSONNES[personne],
          }))}
        />
        {erreurs.personne && <p className="mt-1 text-xs text-rouge">{erreurs.personne}</p>}
      </div>

      {/* ── Joie ─────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label
            htmlFor={`${prefixe}-joie`}
            className="text-xs font-medium uppercase tracking-wide text-attenue"
          >
            Niveau de joie
          </label>
          <span className="text-xs text-attenue">{libelleJoie(valeur.joie)}</span>
        </div>

        <div className="flex items-center gap-4">
          <span aria-hidden className="text-2xl leading-none">
            {VISAGES[valeur.joie - 1]}
          </span>
          <span
            style={{ color: accent }}
            className="w-12 shrink-0 text-3xl font-semibold tabulaire leading-none"
          >
            {valeur.joie}
          </span>
          <input
            id={`${prefixe}-joie`}
            type="range"
            min={JOIE_MIN}
            max={JOIE_MAX}
            step={1}
            value={valeur.joie}
            onChange={(e) => modifier("joie", Number(e.target.value))}
            aria-valuetext={`${valeur.joie} sur ${JOIE_MAX} — ${libelleJoie(valeur.joie)}`}
            className="curseur-joie flex-1"
            style={
              {
                "--accent-curseur": accent,
                "--piste": `linear-gradient(90deg, ${accent} 0%, ${accent} ${remplissage}%, var(--surface-3) ${remplissage}%)`,
              } as React.CSSProperties
            }
          />
        </div>

        <div className="mt-1 flex justify-between px-0.5 text-[11px] text-faible tabulaire">
          <span>{JOIE_MIN}</span>
          <span>{JOIE_MAX}</span>
        </div>
        {erreurs.joie && <p className="text-xs text-rouge">{erreurs.joie}</p>}
      </div>

      {/* ── Déclencheurs ─────────────────────────────────────────────── */}
      <div>
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-attenue">
          Déclencheurs du jour
        </span>
        {/* Deux colonnes dès que le conteneur est assez large — la fenêtre
            de modification l'est, la colonne latérale du tableau de bord non. */}
        <div className="@container">
          <div className="grid gap-2 @sm:grid-cols-2">
            <Bascule
              actif={valeur.biberon}
              onChange={(actif) => modifier("biberon", actif)}
              libelle={DECLENCHEURS[0].libelle}
              description="Présent ce jour"
              icone={<Baby size={18} />}
              couleur="var(--ardoise)"
            />
            <Bascule
              actif={valeur.planteVerte}
              onChange={(actif) => modifier("planteVerte", actif)}
              libelle={DECLENCHEURS[1].libelle}
              description="Présent ce jour"
              icone={<Leaf size={18} />}
              couleur="var(--vert)"
            />
          </div>
        </div>
      </div>

      {/* ── Notes ────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label
            htmlFor={`${prefixe}-notes`}
            className="text-xs font-medium uppercase tracking-wide text-attenue"
          >
            Notes <span className="normal-case text-faible">(optionnel)</span>
          </label>
          <span className="text-[11px] tabulaire text-faible">
            {valeur.notes?.length ?? 0}/{NOTES_MAX}
          </span>
        </div>
        <textarea
          id={`${prefixe}-notes`}
          rows={2}
          maxLength={NOTES_MAX}
          value={valeur.notes ?? ""}
          onChange={(e) => modifier("notes", e.target.value || null)}
          placeholder="Ce qui a marqué la journée…"
          className="w-full resize-y rounded-xl border border-bordure bg-surface px-3 py-2 text-sm transition placeholder:text-faible focus:border-ardoise"
        />
        {erreurs.notes && <p className="mt-1 text-xs text-rouge">{erreurs.notes}</p>}
      </div>
    </div>
  );
}
