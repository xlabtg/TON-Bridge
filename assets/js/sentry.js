// Sentry browser SDK loader — initialised once per page.
// DSN is injected at build time via SENTRY_DSN env var (see eleventy.config.js).
// When SENTRY_DSN is empty the module is a no-op so dev/test builds are unaffected.
(function () {
  var DSN = '__SENTRY_DSN__';
  var RELEASE = '__SENTRY_RELEASE__';
  var ENVIRONMENT = '__SENTRY_ENVIRONMENT__';
  var TRACES_SAMPLE_RATE = parseFloat('__SENTRY_TRACES_SAMPLE_RATE__') || 0.1;

  if (!DSN || DSN === '__SENTRY_DSN__') {
    // No DSN injected — define a no-op stub so other scripts can call
    // Sentry.setUser() etc. without errors.
    window.Sentry = {
      init: function () {},
      setUser: function () {},
      captureException: function () {},
      captureMessage: function () {},
    };
    return;
  }

  // PII fields that must never reach Sentry
  var PII_KEYS = ['initData', 'hash', 'auth_date', 'bearer', 'authorization'];

  function scrubObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var out = Array.isArray(obj) ? [] : {};
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      var lk = key.toLowerCase();
      if (PII_KEYS.some(function (k) { return lk.indexOf(k) !== -1; })) {
        out[key] = '[Filtered]';
      } else {
        out[key] = scrubObject(obj[key]);
      }
    }
    return out;
  }

  function scrubUrl(url) {
    if (typeof url !== 'string') return url;
    try {
      var u = new URL(url);
      PII_KEYS.forEach(function (k) {
        if (u.searchParams.has(k)) u.searchParams.set(k, '[Filtered]');
      });
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  // Dynamically load the Sentry SDK from CDN (network-only, never precached).
  // Using the lazy CDN bundle keeps Sentry out of the SW precache list (#2.1).
  var script = document.createElement('script');
  script.crossOrigin = 'anonymous';
  // Sentry v7 lazy loader — only downloads the full SDK when an error occurs.
  script.src = 'https://browser.sentry-cdn.com/7.120.3/bundle.tracing.replay.min.js';
  script.integrity = '';
  script.onload = function () {
    if (!window.Sentry) return;
    window.Sentry.init({
      dsn: DSN,
      release: RELEASE || undefined,
      environment: ENVIRONMENT || 'production',
      sampleRate: 1.0,
      tracesSampleRate: TRACES_SAMPLE_RATE,
      // Proxy events through our own domain so ad-blockers don't drop them.
      tunnel: '/sentry-tunnel',
      beforeSend: function (event) {
        // Strip PII from request URLs and extra data
        if (event.request) {
          if (event.request.url) event.request.url = scrubUrl(event.request.url);
          if (event.request.data) event.request.data = scrubObject(event.request.data);
          if (event.request.headers) event.request.headers = scrubObject(event.request.headers);
          if (event.request.query_string) event.request.query_string = scrubObject(event.request.query_string);
        }
        if (event.extra) event.extra = scrubObject(event.extra);
        return event;
      },
      beforeSendTransaction: function (event) {
        if (event.request && event.request.url) {
          event.request.url = scrubUrl(event.request.url);
        }
        return event;
      },
    });

    // Attach Telegram user id (numeric only) once the SDK is ready.
    // initDataUnsafe may not be populated until after ready(); we read it lazily.
    try {
      var tg = window.Telegram && window.Telegram.WebApp;
      var userId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
      if (userId) {
        window.Sentry.setUser({ id: String(userId) });
      }
    } catch (e) {
      // Non-fatal — user context is optional.
    }

    // Dev-only test button — injects a "Sentry Test" button into the page so
    // engineers can verify the reporting pipeline works.  Only active when
    // SENTRY_ENVIRONMENT is "development" or when the URL contains ?sentry-test.
    var isDev = ENVIRONMENT === 'development' || window.location.search.indexOf('sentry-test') !== -1;
    if (isDev) {
      var btn = document.createElement('button');
      btn.id = 'sentry-test-btn';
      btn.textContent = 'Sentry Test';
      btn.style.cssText = 'position:fixed;bottom:80px;right:16px;z-index:9999;' +
        'background:#e11d48;color:#fff;border:none;border-radius:6px;' +
        'padding:8px 14px;font-size:13px;cursor:pointer;opacity:0.85;';
      btn.addEventListener('click', function () {
        throw new Error('Sentry test error — triggered manually via dev button');
      });
      document.body.appendChild(btn);
    }
  };

  document.head.appendChild(script);
})();
