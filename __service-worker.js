// Service Worker — TON Bridge
// Version is injected at build time via build-sw.js; fallback to timestamp.
var SW_VERSION = self.__SW_VERSION || 'dev';

var PRECACHE_NAME = 'precache-' + SW_VERSION;
var RUNTIME_NAME = 'runtime-' + SW_VERSION;

// All first-party assets to cache on install.
// This list is kept in sync manually; a build script may replace it.
var PRECACHE_URLS = [
  // HTML pages
  'index.html',
  'index-ru.html',
  'index2.html',
  'index2-ru.html',
  'index3.html',
  'index3-ru.html',
  'index4.html',
  '0.html',
  '0-ru.html',
  '1.html',
  '1-ru.html',
  '2.html',
  '2-ru.html',
  'app-settings.html',
  'app-settings-ru.html',
  // Manifest
  '__manifest.json',
  // CSS
  'assets/css/style.css',
  'assets/css/keyboard-styles.css',
  'assets/css/src/bootstrap/bootstrap.min.css',
  'assets/css/src/splide/splide.min.css',
  // JS
  'assets/js/base.js',
  'assets/js/back-button.js',
  'assets/js/keyboard-handler.js',
  'assets/js/offline.js',
  'assets/js/lib/bootstrap.bundle.min.js',
  'assets/js/plugins/apexcharts/apexcharts.min.js',
  'assets/js/plugins/splide/splide.min.js',
  // Icons
  'assets/img/icon/72x72.png',
  'assets/img/icon/96x96.png',
  'assets/img/icon/128x128.png',
  'assets/img/icon/144x144.png',
  'assets/img/icon/152x152.png',
  'assets/img/icon/192x192.png',
  'assets/img/icon/384x384.png',
  'assets/img/icon/512x512.png',
  // Images
  'assets/img/favicon.png',
  'assets/img/ton-logo.png',
  'assets/img/loading-icon.png',
  'assets/img/gfx-a-1.png',
  'assets/img/OTC.png',
];

// Third-party origins to never cache.
var NETWORK_ONLY_ORIGINS = [
  'changenow.io',
  'tganalytics.xyz',
  'mc.yandex.ru',
  'unpkg.com',
  'telegram.org',
];

function isNetworkOnly(url) {
  return NETWORK_ONLY_ORIGINS.some(function (origin) {
    return url.hostname.endsWith(origin);
  });
}

// Install: precache all first-party assets.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(PRECACHE_NAME)
      .then(function (cache) {
        return cache.addAll(PRECACHE_URLS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

// Activate: delete all caches that don't match the current version.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function (name) {
              return name !== PRECACHE_NAME && name !== RUNTIME_NAME;
            })
            .map(function (name) {
              return caches.delete(name);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// Fetch: route requests by strategy.
self.addEventListener('fetch', function (event) {
  var url;
  try {
    url = new URL(event.request.url);
  } catch (e) {
    return;
  }

  // Never cache third-party origins — let them go straight to network.
  if (isNetworkOnly(url)) {
    return;
  }

  // Only handle GET requests.
  if (event.request.method !== 'GET') {
    return;
  }

  var destination = event.request.destination;

  // HTML → stale-while-revalidate: serve from cache, update in background.
  if (destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Assets (CSS, JS, images) → cache-first with 30-day max-age.
  if (
    destination === 'style' ||
    destination === 'script' ||
    destination === 'image' ||
    destination === 'font' ||
    url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|webp|woff|woff2|ico)$/)
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Manifest and other same-origin resources → cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
  }
});

// Stale-while-revalidate: serve cached response immediately, then fetch & update cache.
function staleWhileRevalidate(request) {
  return caches.open(RUNTIME_NAME).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var fetchPromise = fetch(request).then(function (networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(function () {
        // Network failed; return undefined so caller falls back to cached.
        return undefined;
      });

      if (cached) {
        // Kick off revalidation but immediately return the cached response.
        fetchPromise.catch(function () {});
        return cached;
      }
      // No cache entry yet — wait for the network.
      return fetchPromise.then(function (response) {
        if (response) return response;
        // Offline and nothing cached — try the precache.
        return caches.match(request);
      });
    });
  });
}

// Cache-first: return from cache; only go to network if not cached.
function cacheFirst(request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (networkResponse) {
      if (networkResponse && networkResponse.status === 200) {
        var responseToCache = networkResponse.clone();
        caches.open(RUNTIME_NAME).then(function (cache) {
          cache.put(request, responseToCache);
        });
      }
      return networkResponse;
    });
  });
}
