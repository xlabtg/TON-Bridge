(function () {
  var STORAGE_KEY = 'tgbridge_utm';

  // Parse UTM fields encoded in Telegram start_param.
  // Expected format: "utm_source__<src>__utm_medium__<med>__utm_campaign__<camp>"
  // Alternatively the param may be a plain utm_source value (e.g. "tonapp").
  function parseStartParam(raw) {
    if (!raw) return null;
    var result = {};
    // Try structured format first: key__value pairs separated by __
    var parts = raw.split('__');
    if (parts.length >= 2) {
      for (var i = 0; i < parts.length - 1; i += 2) {
        result[parts[i]] = parts[i + 1];
      }
    }
    if (!result.utm_source) {
      // Fallback: treat the whole param as utm_source
      result.utm_source = raw;
    }
    return result;
  }

  function loadUtm() {
    // First-open: read from Telegram start_param and persist in sessionStorage
    try {
      var tg = window.Telegram && window.Telegram.WebApp;
      var startParam = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
      if (startParam && startParam.indexOf('utm') !== -1) {
        var parsed = parseStartParam(startParam);
        if (parsed) {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          return parsed;
        }
      }
    } catch (e) {}

    // Subsequent pages in the same session
    try {
      var stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {}

    return null;
  }

  function fireYandexMetrika(utm) {
    if (!utm || !utm.utm_source) return;
    try {
      if (typeof ym === 'function') {
        ym(98019798, 'hit', window.location.href, {
          params: {
            utm_source: utm.utm_source || '',
            utm_medium: utm.utm_medium || '',
            utm_campaign: utm.utm_campaign || ''
          }
        });
      }
    } catch (e) {}
  }

  // Expose UTM data globally for other scripts
  window.__tonbridgeUtm = loadUtm();

  // Fire Metrika after page load (ym may not be initialised yet)
  window.addEventListener('load', function () {
    fireYandexMetrika(window.__tonbridgeUtm);
  });
})();
