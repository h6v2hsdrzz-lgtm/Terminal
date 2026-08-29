/**
 * Export du journal en CSV ou en JSON, depuis le navigateur — ce qui est
 * exporté est exactement ce que le tableau affiche, filtres et tri compris.
 *
 * Le CSV vise le tableur français : séparateur point-virgule, BOM UTF-8 pour
 * qu'Excel ne massacre pas les accents, dates en JJ/MM/AAAA.
 */
import { isoVersFr } from "./date";
import type { Entree } from "./types";

const COLONNES = [
  "id",
  "date",
  "personne",
  "joie",
  "biberon",
  "plante_verte",
  "notes",
] as const;

function echapper(valeur: string): string {
  return /[";\n\r]/.test(valeur) ? `"${valeur.replaceAll('"', '""')}"` : valeur;
}

export function versCsv(entrees: Entree[]): string {
  const lignes = [COLONNES.join(";")];

  for (const entree of entrees) {
    lignes.push(
      [
        entree.id,
        isoVersFr(entree.date),
        entree.personne,
        String(entree.joie),
        entree.biberon ? "Vrai" : "Faux",
        entree.planteVerte ? "Vrai" : "Faux",
        entree.notes ?? "",
      ]
        .map(echapper)
        .join(";"),
    );
  }

  return `﻿${lignes.join("\r\n")}`;
}

export function versJson(entrees: Entree[]): string {
  return JSON.stringify(
    entrees.map((entree) => ({
      id: entree.id,
      date: isoVersFr(entree.date),
      personne: entree.personne,
      joie: entree.joie,
      biberon: entree.biberon,
      plante_verte: entree.planteVerte,
      notes: entree.notes,
    })),
    null,
    2,
  );
}

export function nomFichier(extension: "csv" | "json"): string {
  const horodatage = new Date().toISOString().slice(0, 10);
  return `joie-${horodatage}.${extension}`;
}

/** Déclenche le téléchargement d'un contenu texte, sans passer par le serveur. */
export function telecharger(contenu: string, nom: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contenu], { type: `${type};charset=utf-8` }));
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  document.body.append(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}

export function exporterCsv(entrees: Entree[]): void {
  telecharger(versCsv(entrees), nomFichier("csv"), "text/csv");
}

export function exporterJson(entrees: Entree[]): void {
  telecharger(versJson(entrees), nomFichier("json"), "application/json");
}
