/**
 * Le plafond de stockage, et d'où il vient.
 *
 * Deux chiffres, parce qu'il y a deux endroits possibles. Tant que les octets
 * vivent dans PostgreSQL, la limite est celle de l'offre gratuite de Neon : un
 * demi-giga-octet, partagé avec les journées elles-mêmes. Dès que R2 est
 * configuré, c'est son palier gratuit qui compte : dix giga-octets, et pas de
 * frais de sortie.
 *
 * Le fichier ne lit l'environnement qu'à travers `process.env` : pas de
 * `server-only` ici, pour que l'écran puisse afficher le bon nombre sans
 * traîner la moitié du dépôt avec lui.
 */
export const PLAFOND_BASE = 512 * 1024 * 1024;
export const PLAFOND_SEAU = 10 * 1024 * 1024 * 1024;

function distant(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.R2_COMPTE && env.R2_SEAU && env.R2_CLE && env.R2_SECRET);
}

export const PLAFOND_STOCKAGE = distant() ? PLAFOND_SEAU : PLAFOND_BASE;

export function nomDuDepot(env: NodeJS.ProcessEnv = process.env): string {
  return distant(env) ? "Cloudflare R2" : "la base";
}
