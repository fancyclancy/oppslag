// Offline support. App shell: served straight from this release's cache, so a cold start never waits
// on the network (network-first cost ~1.8s of white screen on mobile data). Each release has its own
// SHELL name, so its install fetches every shell file fresh ('reload', past GitHub Pages' 10-minute
// browser cache); the page switches to it the next time the app goes to the background (app.js).
// Data: cache-first; meta.json asks the network but waits at most a moment.
const SHELL = 'oppslag-shell-v20';
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
    if (url.pathname.endsWith('/meta.json')) { e.respondWith(networkFirst(e.request, DATA, true, 700)); return; }
    e.respondWith(cacheFirst(e.request, DATA));
    return;
  }
  e.respondWith(shellFirst(e.request));
});
async function shellFirst(req) {
  const c = await caches.open(SHELL);
  const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && ((await c.match('index.html')) || (await c.match('./'))));
  if (hit) return hit;
  try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
  catch { return Response.error(); }
}
async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) c.put(req, r.clone());
  return r;
}
// with a timeout, a slow network falls back to the cached copy (the fetch still updates the cache)
async function networkFirst(req, name, revalidate = false, timeout = 0) {
  const c = await caches.open(name);
  const net = (async () => {
    // 'no-cache' asks the server whether the file changed (a tiny 304 when it hasn't)
    const r = revalidate ? await fetch(new Request(req, { cache: 'no-cache' })) : await fetch(req);
    if (r.ok) await c.put(req, r.clone());
    return r;
  })();
  const cached = () => c.match(req, { ignoreSearch: true });
  try {
    if (!timeout) return await net;
    const late = new Promise(res => setTimeout(res, timeout, 'late'));
    const first = await Promise.race([net, late]);
    if (first !== 'late') return first;
    return (await cached()) || (await net);
  } catch {
    return (await cached()) || Response.error();
  }
}
// When the dictionary is rebuilt, the page posts a message to clear stale data
self.addEventListener('message', async (e) => {
  if (e.data === 'clear-data') { await caches.delete(DATA); }
});
