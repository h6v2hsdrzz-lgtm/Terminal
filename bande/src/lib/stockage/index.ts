import "server-only";

import { configurationR2, ecrireR2, lireR2, supprimerR2 } from "./r2";

export { cleAudio, cleCapsule, cleMedia, cleParole } from "./cles";

/**
 * Où vivent les octets.
 *
 * Deux dépôts, une seule interface. PostgreSQL depuis le premier jour — c'était
 * le choix qui évitait un compte de plus, et il a tenu tant qu'il n'y avait que
 * des photos. Cloudflare R2 maintenant, parce que le palier gratuit de Neon
 * s'arrête à un demi-giga-octet et que R2 en offre dix, sans frais de sortie.
 *
 * **La bascule se fait par variables d'environnement, et elle est réversible.**
 * Tant que les quatre valeurs R2 ne sont pas là, tout continue comme avant.
 * Un média porte une clé quand ses octets sont chez R2, et rien quand ils sont
 * en base : les deux coexistent, ce qui rend la migration progressive et le
 * retour en arrière possible.
 */

/** Vrai quand les octets doivent partir chez R2 plutôt qu'en base. */
export function stockageDistant(): boolean {
  return configurationR2() !== null;
}

/**
 * Écrit les octets là où ils doivent aller.
 *
 * Rend la clé quand ils sont partis chez R2, et `null` quand ils restent en
 * base — c'est cette valeur que l'appelant range dans la colonne `cle`, et
 * c'est elle qui dira plus tard où les relire.
 */
export async function ecrireOctets(
  cle: string,
  octets: Uint8Array,
  mime: string,
): Promise<string | null> {
  const config = configurationR2();
  if (!config) return null;
  await ecrireR2(config, cle, octets, mime);
  return cle;
}

/**
 * Relit des octets rangés chez R2.
 *
 * Ne sait rien de PostgreSQL : quand la clé est nulle, l'appelant a déjà les
 * octets sous la main, et rien ne justifie un aller-retour.
 */
export async function lireOctets(cle: string): Promise<Uint8Array<ArrayBuffer> | null> {
  // Une clé vide veut dire « il n'y en a pas » : les appelants passent
  // `media.cle ?? ""` pour n'avoir qu'un chemin de code, et une requête sur la
  // racine du seau ne rendrait de toute façon rien de bon.
  if (!cle) return null;
  const config = configurationR2();
  if (!config) return null;
  return lireR2(config, cle);
}

/**
 * Efface les octets d'une clé. Sans configuration, il n'y a rien à effacer.
 *
 * Le silence en cas d'échec est délibéré : une suppression de journée ne doit
 * pas échouer parce qu'un objet distant résiste. La ligne part, l'objet reste
 * orphelin, et `scripts/nettoyer-r2.ts` le ramassera — c'est le bon ordre des
 * priorités, le droit de retrait passe avant la propreté du seau.
 */
export async function supprimerOctets(cle: string | null): Promise<void> {
  if (!cle) return;
  const config = configurationR2();
  if (!config) return;
  try {
    await supprimerR2(config, cle);
  } catch {
    // Voir plus haut : on ne bloque jamais un retrait là-dessus.
  }
}
