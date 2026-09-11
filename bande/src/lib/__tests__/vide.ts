/**
 * Le remplaçant de `server-only` sous Vitest.
 *
 * `server-only` ne fait qu'une chose : lever à l'import depuis un paquet
 * client, pour que le build de Next échoue au lieu d'envoyer du code serveur
 * au navigateur. Hors de Next il n'a rien à garder, et il lève pour rien.
 */
export {};
