// FocusFive service worker: installable + works offline (school Wi-Fi dead zones).
// - Own files: network first with a short timeout, so you get updates when online
//   but never wait long on a weak signal.
// - Tailwind + Google Fonts: cached so the app keeps its styling offline.
// - Gemini API calls are never touched.
const CACHE = 'focusfive-v3';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];
const CDN_PRECACHE = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Oswald:wght@600;700&display=swap'
];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_TIMEOUT_MS = 3500;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.addAll(SHELL).catch(() => {});
    // no-cors matches how <script src> and <link rel=stylesheet> request these files.
    await Promise.all(CDN_PRECACHE.map(url =>
      fetch(new Request(url, { mode: 'no-cors' }))
        .then(res => cache.put(url, res))
        .catch(() => {})
    ));
  }));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheable(res) {
  return res && (res.ok || res.type === 'opaque');
}

// Tailwind / fonts: serve from cache instantly, refresh in the background.
function staleWhileRevalidate(req) {
  return caches.open(CACHE).then(cache =>
    cache.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (cacheable(res)) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
}

// Own files: try the network, but fall back to cache after a few seconds.
function networkFirst(req) {
  return caches.open(CACHE).then(cache => {
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    network.catch(() => {}); // avoid unhandled-rejection noise when the timeout wins
    const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    const fromCache = () => cache.match(req, { ignoreSearch: req.mode === 'navigate' })
      .then(r => r || (req.mode === 'navigate' ? cache.match('./index.html') : undefined));

    return Promise.race([network, timeout.then(() => fromCache())])
      .then(res => res || network)
      .catch(() => fromCache().then(r => r || Response.error()));
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.origin !== self.location.origin) return; // e.g. Gemini API: straight to network

  e.respondWith(networkFirst(req));
});
