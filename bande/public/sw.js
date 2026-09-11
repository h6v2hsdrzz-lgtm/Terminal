/**
 * Le service worker.
 *
 * Il fait deux choses : garder l'application ouvrable sans réseau, et recevoir
 * les notifications poussées.
 *
 * Pour le hors-ligne, trois règles, dans cet ordre :
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

// ── Les notifications poussées ─────────────────────────────────────────────
//
// Le serveur envoie un objet JSON chiffré ; le navigateur le déchiffre et nous
// le passe ici. On l'affiche, et on garde le chemin de destination pour savoir
// où aller si quelqu'un la touche.
//
// L'ÉTIQUETTE fait tout le travail discret : deux notifications de même
// étiquette se remplacent au lieu de s'empiler. Trois commentaires sur la même
// journée font une ligne, pas trois — c'est la différence entre une application
// qu'on garde et une qu'on coupe.

self.addEventListener("push", (evenement) => {
  if (!evenement.data) return;

  let contenu;
  try {
    contenu = evenement.data.json();
  } catch {
    // Un message qu'on ne sait pas lire ne doit pas faire disparaître la
    // notification : le système en affiche une générique si on ne fait rien,
    // et c'est encore mieux que rien.
    return;
  }

  evenement.waitUntil(
    self.registration.showNotification(contenu.titre ?? "Journal de joie", {
      body: contenu.corps ?? "",
      icon: "/icone-192.png",
      badge: "/icone-192.png",
      tag: contenu.etiquette ?? "joie",
      // Remplacer sans vibrer : la première notification d'un groupe fait du
      // bruit, les suivantes mettent juste la ligne à jour.
      renotify: false,
      data: { vers: contenu.vers ?? "/" },
    }),
  );
});

// Le lien profond : toucher une notification ouvre la bonne journée, la bonne
// photo ou la bonne partie — pas l'accueil. Et si l'application est déjà
// ouverte quelque part, on la réutilise au lieu d'ouvrir un deuxième onglet.
self.addEventListener("notificationclick", (evenement) => {
  evenement.notification.close();
  const vers = (evenement.notification.data && evenement.notification.data.vers) || "/";

  evenement.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      for (const fenetre of fenetres) {
        if ("focus" in fenetre) {
          // `navigate` n'existe pas partout : on se rabat sur un message que
          // l'application écoute, et sinon sur une nouvelle fenêtre.
          if ("navigate" in fenetre) return fenetre.navigate(vers).then((f) => f && f.focus());
          fenetre.postMessage({ type: "aller", vers });
          return fenetre.focus();
        }
      }
      return self.clients.openWindow(vers);
    }),
  );
});
