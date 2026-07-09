const CACHE_NAME = 'zoldnyom-v8';

// Ritkán változó, nagy fájlok — ezeket cache-first módon szolgáljuk ki (gyors, spórol adatforgalmat).
const STATIC_FILES = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './model/waste.tflite'
];

// Az app "váza" — ezek gyakran változnak fejlesztés közben, ezért mindig a legfrissebbet
// próbáljuk betölteni a hálózatról, és csak akkor esünk vissza a cache-re, ha nincs net.
const SHELL_FILES = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/firebase-init.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...STATIC_FILES, ...SHELL_FILES]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isShellPath(pathname) {
  if (pathname === '/' || pathname.endsWith('/index.html')) return true;
  return SHELL_FILES.some((f) => f !== './' && pathname.endsWith(f.replace('./', '/')));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // külső (CDN) kéréseket nem piszkáljuk

  if (isShellPath(url.pathname)) {
    // Network-first: mindig a legfrissebb verziót próbáljuk betölteni.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache-first a statikus, nagy fájloknak (ikonok, AI-modell).
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
});
