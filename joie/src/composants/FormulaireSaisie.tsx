"use client";

import { Check, Loader2, PenLine, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ErreurApi } from "@/lib/api";
import { aujourdhuiIso, isoVersFr } from "@/lib/date";
import type { Entree, SaisieEntree } from "@/lib/types";
import { validerSaisie, type Champ } from "@/lib/validation";

import { ChampsEntree } from "./ChampsEntree";
import { useJournal } from "./FournisseurJournal";
import { Carte } from "./ui/Carte";

const VIDE: SaisieEntree = {
  date: aujourdhuiIso(),
  personne: "Momo",
  joie: 7,
  biberon: false,
  planteVerte: false,
  notes: null,
};

/**
 * Saisie rapide. Le couple (date, personne) est la clé d'une entrée : dès
 * qu'il désigne une mesure déjà enregistrée, le formulaire la charge et
 * annonce qu'il modifiera au lieu d'ajouter — plutôt que d'écraser en silence.
 */
export function FormulaireSaisie() {
  const { entrees, enregistrer, signaler } = useJournal();
  const [valeur, setValeur] = useState<SaisieEntree>(VIDE);
  const [erreurs, setErreurs] = useState<Partial<Record<Champ, string>>>({});
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [confirme, setConfirme] = useState(false);

  const existante: Entree | undefined = entrees.find(
    (e) => e.date === valeur.date && e.personne === valeur.personne,
  );

  // Recharger les champs quand la sélection change de cible, et seulement
  // alors : pendant la frappe, l'utilisateur reste maître de ses valeurs.
  const cible = `${valeur.date}|${valeur.personne}`;
  // Sentinelle : au premier rendu la cible n'a jamais été chargée, donc
  // l'entrée du jour est reprise si elle existe déjà.
  const cibleRef = useRef("");
  useEffect(() => {
    if (cibleRef.current === cible) return;
    cibleRef.current = cible;
    setErreurs({});
    setValeur((actuelle) => {
      const dejaLa = entrees.find(
        (e) => e.date === actuelle.date && e.personne === actuelle.personne,
      );
      return dejaLa
        ? {
            date: dejaLa.date,
            personne: dejaLa.personne,
            joie: dejaLa.joie,
            biberon: dejaLa.biberon,
            planteVerte: dejaLa.planteVerte,
            notes: dejaLa.notes,
          }
        : { ...VIDE, date: actuelle.date, personne: actuelle.personne };
    });
  }, [cible, entrees]);

  async function soumettre(evenement: React.FormEvent) {
    evenement.preventDefault();
    if (envoiEnCours) return;

    const controle = validerSaisie(valeur);
    if (!controle.ok) {
      setErreurs(controle.erreurs);
      return;
    }

    setEnvoiEnCours(true);
    setErreurs({});
    try {
      await enregistrer(controle.valeur);
      signaler(
        existante
          ? `Entrée du ${isoVersFr(valeur.date)} mise à jour pour ${valeur.personne}.`
          : `Joie de ${valeur.personne} enregistrée pour le ${isoVersFr(valeur.date)}.`,
      );
      setConfirme(true);
      setTimeout(() => setConfirme(false), 1600);
    } catch (erreur) {
      if (erreur instanceof ErreurApi) {
        setErreurs(erreur.erreurs);
        signaler(erreur.message, "erreur");
      } else {
        signaler("Enregistrement impossible — le serveur ne répond pas.", "erreur");
      }
    } finally {
      setEnvoiEnCours(false);
    }
  }

  return (
    <Carte
      titre="Saisie du jour"
      sousTitre="Une mesure par personne et par jour"
      icone={<PenLine size={16} />}
    >
      <form onSubmit={soumettre} noValidate>
        {existante && (
          <p className="mb-4 flex items-start gap-2 rounded-xl border border-bordure bg-surface-2 px-3 py-2 text-xs text-attenue">
            <PenLine size={14} className="mt-0.5 shrink-0 text-ambre" />
            <span>
              {valeur.personne} a déjà une entrée le {isoVersFr(valeur.date)} — les champs
              sont pré-remplis, la validation la mettra à jour.
            </span>
          </p>
        )}

        <ChampsEntree valeur={valeur} onChange={setValeur} erreurs={erreurs} idPrefixe="saisie" />

        <button
          type="submit"
          disabled={envoiEnCours}
          style={{
            backgroundColor: confirme ? "var(--vert)" : "var(--action)",
            color: confirme ? "#ffffff" : "var(--action-texte)",
          }}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-70"
        >
          {envoiEnCours ? (
            <Loader2 size={16} className="animate-spin" />
          ) : confirme ? (
            <Check size={16} />
          ) : existante ? (
            <PenLine size={16} />
          ) : (
            <Plus size={16} />
          )}
          {envoiEnCours
            ? "Enregistrement…"
            : confirme
              ? "Enregistré"
              : existante
                ? "Mettre à jour l'entrée"
                : "Enregistrer la journée"}
        </button>
      </form>
    </Carte>
  );
}
