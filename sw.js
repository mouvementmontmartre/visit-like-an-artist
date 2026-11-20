/* ============================================================
   SERVICE WORKER — hors ligne
   Stratégie :
   - App shell (HTML, CSS, JS, icônes, polices) : cache d'abord,
     mis à jour en arrière-plan à chaque visite en ligne.
   - Données Google Sheets : réseau d'abord (fraîcheur), le repli
     hors-ligne est géré par app.js via localStorage.
   Pour forcer une mise à jour chez tous les utilisateurs après
   une modification du code : incrémenter CACHE_VERSION.
   ============================================================ */

const CACHE_VERSION = "mm-v103";

const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./css/theme-artdive.css",
  "./fonts/Fraunces-Variable.woff2",
  "./fonts/Fraunces-Italic-Variable.woff2",
  "./fonts/DMSans-Variable.woff2",
  "./fonts/JetBrainsMono-Regular.woff2",
  "./fonts/JetBrainsMono-Medium.woff2",
  "./js/config.js",
  "./js/csv.js",
  "./js/data-lieux.js",
  "./js/i18n.js",
  "./js/app.js",
  "./js/admin.js",
  "./js/formulaires.js",
  "./js/parcours.js",
  "./manifest.json",
  "./icons/logo.png",
  "./icons/logo-splash.png",
  "./icons/artdive-wordmark-cream.svg",
  "./icons/artdive-monogram-cream.svg",
  "./icons/artdive-favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/poster-festival.jpg",
  "./icons/banniere-jazzical.jpg",
  "./icons/banniere-dames.jpg",
  "./icons/banniere-ecosysteme.jpg",
  "./icons/sponsor-kubo.jpg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Les données Google (CSV) passent toujours par le réseau ;
  // app.js gère lui-même le repli hors-ligne via localStorage.
  if (url.hostname.includes("google")) return;

  // Fonctions serveur (paiement, carte de membre) : jamais en cache.
  if (url.pathname.startsWith("/.netlify/functions/")) return;

  // Base de données (places restantes, dates) : toujours fraîche, jamais en cache.
  if (url.hostname.endsWith(".supabase.co")) return;

  // App shell + polices : cache d'abord, réseau en secours,
  // et mise à jour silencieuse du cache quand le réseau répond.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res && res.ok && e.request.method === "GET") {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
