/* Only static application files are cached. API responses/credentials never enter CacheStorage. */
const CACHE = 'sklad-static-v14-2';
const FILES = ['index.html','styles.css','core.js','data.js','connection.js','backups.js','reports.js','ui.js','app.js','workspace.js','operators.js','vendor/supabase-2.119.0.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('sklad-static-') && key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const root = new URL('./', self.location.href);
  const relative = url.pathname.slice(root.pathname.length);
  if (relative !== '' && !FILES.includes(relative)) return;
  event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(relative === '' ? 'index.html' : event.request))));
});
