import { NextResponse } from "next/server";

import { arrondirPosition, cleCache, nomDuLieu } from "@/lib/lieu";
import { membreConnecte } from "@/lib/session";

/**
 * Le nom d'un lieu, à partir d'une position.
 *
 * Trois choix, et aucun n'est cosmétique.
 *
 * **La requête part du serveur, pas du téléphone.** Appeler Nominatim depuis le
 * navigateur enverrait la position de quelqu'un, avec son adresse IP, à un
 * service tiers — pour un journal privé, c'est exactement ce qu'on ne veut
 * pas. Ici, le tiers ne voit que notre serveur.
 *
 * **La position est arrondie AVANT d'être envoyée.** Deux décimales, environ un
 * kilomètre : assez pour nommer un quartier, pas assez pour trouver une porte.
 * Ce qui n'est pas envoyé ne peut pas fuir.
 *
 * **Un cache en mémoire, et un `User-Agent` identifiable**, parce que la
 * politique d'usage de Nominatim demande un appel par action et de pouvoir
 * nous joindre. Le cache vit le temps du processus — c'est un service gratuit
 * qu'on utilise en invité, pas une base à nous.
 */
const CACHE = new Map<string, { nom: string | null; a: number }>();
const DUREE_CACHE = 24 * 60 * 60 * 1000;
const AGENT = "JournalDeJoie/1.0 (application privée, 3 utilisateurs)";

export async function GET(requete: Request) {
  const membreId = await membreConnecte();
  if (!membreId) return NextResponse.json({ nom: null }, { status: 401 });

  const url = new URL(requete.url);
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ nom: null }, { status: 400 });
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return NextResponse.json({ nom: null }, { status: 400 });
  }

  const cle = cleCache(latitude, longitude);
  const connu = CACHE.get(cle);
  if (connu && Date.now() - connu.a < DUREE_CACHE) {
    return NextResponse.json({ nom: connu.nom, position: arrondirPosition(latitude, longitude) });
  }

  const { latitude: la, longitude: lo } = arrondirPosition(latitude, longitude);
  let nom: string | null = null;
  try {
    const reponse = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${lo}&zoom=14&accept-language=fr`,
      { headers: { "User-Agent": AGENT }, signal: AbortSignal.timeout(6000) },
    );
    if (reponse.ok) {
      const donnees = (await reponse.json()) as { address?: Record<string, string> };
      nom = nomDuLieu(donnees.address);
    }
  } catch {
    // Service indisponible, hors ligne, délai dépassé : on rend `null`. Le
    // champ reste libre, et c'était déjà le cas avant ce bouton.
  }

  CACHE.set(cle, { nom, a: Date.now() });
  return NextResponse.json({ nom, position: { latitude: la, longitude: lo } });
}
