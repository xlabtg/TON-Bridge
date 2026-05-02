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
 * The WORKER_URL constant below must be updated to the deployed Worker URL
 * before going to production.  For local development it falls back to
 * http://localhost:8787 automatically.
 */

(function () {
  var WORKER_URL =
    typeof window !== 'undefined' && window.location.hostname === 'localhost'
      ? 'http://localhost:8787'
      : 'https://ton-bridge-auth.YOUR_ACCOUNT.workers.dev';

  var _token = null;
  var _expiresAt = 0;
  var _user = null;
  var _pending = null; // single in-flight promise

  function verify() {
    if (_pending) return _pending;

    var tg = window.Telegram && window.Telegram.WebApp;
    var initData = tg && tg.initData;

    // Outside the Telegram client initData is empty; skip auth silently.
    if (!initData) {
      _pending = Promise.resolve(null);
      return _pending;
    }

    _pending = fetch(WORKER_URL + '/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: initData }),
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

  // Start verification as soon as the script loads.
  verify();

  window.TonBridgeAuth = {
    verify: verify,
    getToken: getToken,
    getUser: getUser,
  };
})();
