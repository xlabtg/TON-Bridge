/**
 * auth.js — Telegram initData verification helper.
 *
 * Calls POST /auth/verify once per page load, caches the JWT in memory
 * (never in localStorage or CloudStorage), and exposes a getToken() helper
 * for future authenticated requests.
 *
 * Usage:
 *   <script src="assets/js/auth.js"></script>
 *   <!-- auth initialises automatically; read the token via window.TonBridgeAuth.getToken() -->
 *
 * Uses the public workerBaseUrl config when present. For local development it
 * falls back to http://localhost:8787 automatically.
 */

(function () {
  var DEFAULT_WORKER_URL = 'https://ton-bridge-worker.tonbankcard.workers.dev';

  function config() {
    return window.__TON_BRIDGE_CONFIG__ || {};
  }

  function workerUrl() {
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      return 'http://localhost:8787';
    }
    return String(config().workerBaseUrl || DEFAULT_WORKER_URL).replace(/\/+$/, '');
  }

  var _token = null;
  var _expiresAt = 0;
  var _user = null;
  var _pending = null; // single in-flight promise

  function getNotificationsOptOut() {
    if (window.prefs && window.prefs.get) {
      return window.prefs.get('pref:notificationsOptOut').then(function (value) {
        return value === '1';
      }).catch(function () {
        return localStorage.getItem('pref:notificationsOptOut') === '1';
      });
    }

    return Promise.resolve(localStorage.getItem('pref:notificationsOptOut') === '1');
  }

  function getOrderId() {
    var params = new URLSearchParams(window.location.search || '');
    var queryOrder = params.get('order_id') || params.get('orderId');
    if (queryOrder) return queryOrder;

    var hash = window.location.hash || '';
    var match = hash.match(/order_([^&/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function verify() {
    if (_pending) return _pending;

    var tg = window.Telegram && window.Telegram.WebApp;
    var initData = tg && tg.initData;

    // Outside the Telegram client initData is empty; skip auth silently.
    if (!initData) {
      _pending = Promise.resolve(null);
      return _pending;
    }

    _pending = getNotificationsOptOut()
      .then(function (notificationsOptOut) {
        return fetch(workerUrl() + '/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            initData: initData,
            orderId: getOrderId(),
            notificationsOptOut: notificationsOptOut,
          }),
        });
      })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.token) return null;
        _token = data.token;
        _expiresAt = data.expiresAt || 0;
        _user = data.user || null;
        return data;
      })
      .catch(function () {
        return null;
      })
      .finally(function () {
        _pending = null;
      });

    return _pending;
  }

  function getToken() {
    var nowS = Math.floor(Date.now() / 1000);
    if (_token && _expiresAt > nowS) return _token;
    return null;
  }

  function getUser() {
    return _user;
  }

  function getReferral() {
    if (!_user || !_user.ref_code) return null;
    return {
      code: _user.ref_code,
      url: _user.ref_share_url,
    };
  }

  // Start verification as soon as the script loads.
  verify();

  window.TonBridgeAuth = {
    verify: verify,
    getToken: getToken,
    getUser: getUser,
    getReferral: getReferral,
  };
})();
