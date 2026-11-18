/*
 * Service worker : met l'appli en cache pour qu'elle demarre sans Internet.
 * Strategie "reseau d'abord" : pas besoin de changer VERSION pour diffuser une mise a jour.
 */
const VERSION = 'bdc-v3';
const FICHIERS = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/packer.js', 'js/decor.js', 'js/pdfwriter.js', 'js/db.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' = on ignore le cache HTTP pour stocker les vraies versions du serveur
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Supprime les anciennes versions du cache
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Reseau d'abord (les mises a jour arrivent toutes seules), cache si pas d'Internet.
  // Chaque reponse reseau rafraichit le cache pour la prochaine utilisation hors ligne.
  e.respondWith(
    // cache: 'no-cache' = toujours demander au serveur si le fichier a change
    // (sans ca, le cache HTTP du navigateur peut resservir une vieille version)
    fetch(e.request, { cache: 'no-cache' })
      .then((r) => {
        if (r.ok && new URL(e.request.url).origin === location.origin) {
          const copie = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copie));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
