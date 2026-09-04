/**
 * Le service worker.
 *
 * Il fait une seule chose, et la fait bien : garder l'application ouvrable
 * sans réseau. Trois règles, dans cet ordre :
 *
 * 1. Les pages passent par le réseau d'abord. Une bande veut voir la journée
 *    que quelqu'un vient de poser, pas une copie d'hier ; le cache n'est là que
 *    pour le métro et l'ascenseur.
 * 2. Les ressources versionnées — polices, icônes, fichiers compilés — passent
 *    par le cache d'abord. Leur adresse change à chaque déploiement, donc une
 *    réponse en cache ne peut pas être périmée.
 * 3. Tout le reste — les routes d'API, les photos, la synchronisation — n'est
 *    jamais mis en cache. Servir une photo ou une empreinte de version périmée
 *    causerait plus de dégâts qu'une erreur franche.
 */
const VERSION = "joie-v1";
const COQUILLE = "/hors-ligne";

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll([COQUILLE])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

const estVersionnee = (url) =>
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/polices/");

const estIcone = (url) => /^\/icone-.*\.png$/.test(url.pathname);

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;

  // Jamais de cache sur ce qui doit être frais ou privé.
  if (url.pathname.startsWith("/api/")) return;

  if (estVersionnee(url) || estIcone(url)) {
    evenement.respondWith(
      caches.match(requete).then(
        (enCache) =>
          enCache ??
          fetch(requete).then((reponse) => {
            if (reponse.ok) {
              const copie = reponse.clone();
              caches.open(VERSION).then((cache) => cache.put(requete, copie));
            }
            return reponse;
          }),
      ),
    );
    return;
  }

  if (requete.mode === "navigate") {
    evenement.respondWith(
      fetch(requete).catch(async () => {
        const cache = await caches.open(VERSION);
        return (await cache.match(COQUILLE)) ?? Response.error();
      }),
    );
  }
});
