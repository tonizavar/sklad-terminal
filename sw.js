/* Only static application files are cached. API responses/credentials never enter CacheStorage. */
const CACHE = 'sklad-static-classic-id-2';
const FILES = ['index.html','styles.css','themes.css','themes.js','core.js','data.js','connection.js','backups.js','reports.js','ui.js','app.js','workspace.js','operators.js','vendor/supabase-2.119.0.js'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(FILES.map(file => new Request(new URL(file, self.location.href), { cache: 'reload' })));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('sklad-static-') && key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const root = new URL('./', self.location.href);
  if (!url.pathname.startsWith(root.pathname)) return;
  const relative = url.pathname.slice(root.pathname.length);
  if (relative !== '' && !FILES.includes(relative)) return;
  event.respondWith(caches.open(CACHE).then(async cache =>
    await cache.match(relative || 'index.html') || fetch(event.request)));
});
