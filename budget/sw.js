/**
 * Service worker de Prévoyant.
 *
 * Il ne sert qu'à une chose : que l'application posée sur l'écran d'accueil
 * s'ouvre sans réseau. Les données, elles, n'ont jamais quitté le navigateur —
 * rien n'est synchronisé, rien n'est envoyé.
 *
 * Deux stratégies, selon ce qui est demandé :
 *  - la page part sur le réseau d'abord, pour qu'une mise à jour arrive dès
 *    qu'elle existe, avec la copie en cache comme filet ;
 *  - les icônes et les polices sortent du cache d'abord : elles ne changent
 *    pas d'une version à l'autre.
 */

const VERSION = "prevoyant-v1";
const COQUILLE = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icone.svg", "./icone-192.png", "./icone-512.png", "./icone-apple-180.png",
];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION)
      // une icône manquante ne doit pas faire échouer toute l'installation
      .then((cache) => Promise.allSettled(COQUILLE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;

  const url = new URL(requete.url);
  const police = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

  if (requete.mode === "navigate") {
    evenement.respondWith(
      fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put("./index.html", copie)).catch(() => {});
          return reponse;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  if (police || url.origin === self.location.origin) {
    evenement.respondWith(
      caches.match(requete).then((enCache) => {
        if (enCache) return enCache;
        return fetch(requete).then((reponse) => {
          // les polices reviennent en réponse opaque : elles se mettent en
          // cache telles quelles, c'est suffisant pour les réafficher
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(requete, copie)).catch(() => {});
          return reponse;
        });
      })
    );
  }
});
