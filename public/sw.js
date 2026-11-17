// Version en ligne : garde une copie des fichiers de l'appli pour qu'elle
// s'ouvre même sans réseau. Le réseau passe toujours en premier : une mise à
// jour publiée arrive dès la prochaine ouverture avec du réseau.
// (Les données ne passent jamais par ici : elles sont dans le stockage du navigateur.)

const CACHE = 'enduro-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Seulement les fichiers de l'appli elle-même : ni Strava, ni Withings.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // « no-cache » : le navigateur revérifie chaque fichier, pour ne jamais mélanger deux versions de l'appli.
      const res = await fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' }));
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      const copy = await cache.match(req, { ignoreSearch: true });
      if (copy) return copy;
      throw err;
    }
  })());
});
