// Offline support. App shell: network-first and always revalidated with the server, so a new
// release shows up on the next launch (GitHub Pages lets browsers reuse files for 10 minutes,
// which otherwise hides updates). Data: cache-first.
const SHELL = 'oppslag-shell-v19';
const DATA = 'oppslag-data';
const SHELL_FILES = ['./', 'index.html', 'styles.css', 'oppslag-v7.webmanifest', 'js/app.js', 'js/db.js', 'js/store.js', 'js/srs.js',
  'js/speech.js', 'js/render.js', 'js/icons.js', 'icons/bok7-192.png', 'icons/bok7-512.png', 'icons/bok7-180.png', 'icons/bok7-logo.png',
  'fonts/schibsted-grotesk.woff2', 'fonts/newsreader.woff2', 'fonts/newsreader-italic.woff2', 'fonts/gentium-ipa.woff2'];
const CORE_DATA = ['data/index.json', 'data/forms.json', 'data/meta.json'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })));
    const d = await caches.open(DATA);
    await Promise.all(CORE_DATA.map(async (u) => { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) await d.put(new URL(u, self.registration.scope).href, r); }));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('oppslag-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    // meta.json is small and tells us when the dictionary was rebuilt
    if (url.pathname.endsWith('/meta.json')) { e.respondWith(networkFirst(e.request, DATA, true)); return; }
    e.respondWith(cacheFirst(e.request, DATA));
    return;
  }
  e.respondWith(networkFirst(e.request, SHELL, true));
});
async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) c.put(req, r.clone());
  return r;
}
async function networkFirst(req, name, revalidate = false) {
  const c = await caches.open(name);
  try {
    // 'no-cache' asks the server whether the file changed (a tiny 304 when it hasn't)
    // (navigation requests can't be copied with new options, so those are fetched by URL)
    const r = !revalidate ? await fetch(req)
      : req.mode === 'navigate' ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      : await fetch(new Request(req, { cache: 'no-cache' }));
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch {
    return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error();
  }
}
// When the dictionary is rebuilt, the page posts a message to clear stale data
self.addEventListener('message', async (e) => {
  if (e.data === 'clear-data') { await caches.delete(DATA); }
});
