// Service Worker — TON Bridge
// Version is injected at build time via build-sw.js; fallback to timestamp.
var SW_VERSION = self.__SW_VERSION || 'dev';

var PRECACHE_NAME = 'precache-' + SW_VERSION;
var RUNTIME_NAME = 'runtime-' + SW_VERSION;
var ASSET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Injected at build time from dist/ so the install step never references stale files.
var PRECACHE_URLS = self.__PRECACHE_URLS || [];

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
    return url.hostname === origin || url.hostname.endsWith('.' + origin);
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
    if (cached && isFresh(cached)) return cached;
    return fetch(request).then(function (networkResponse) {
      if (networkResponse && networkResponse.status === 200) {
        cacheResponse(request, networkResponse.clone());
      }
      return networkResponse;
    }).catch(function () {
      if (cached) return cached;
      throw new Error('Network request failed and no cached response is available.');
    });
  });
}

function isFresh(response) {
  var cachedAt = Number(response.headers.get('sw-cache-time'));
  return !cachedAt || Date.now() - cachedAt < ASSET_MAX_AGE_MS;
}

function cacheResponse(request, response) {
  return response.blob().then(function (body) {
    var headers = new Headers(response.headers);
    headers.set('sw-cache-time', Date.now().toString());

    var timestampedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers,
    });

    return caches.open(RUNTIME_NAME).then(function (cache) {
      return cache.put(request, timestampedResponse);
    });
  });
}
