/**
 * Deep-link presets for TON Bridge TMA.
 *
 * Grammar (start_param ≤ 64 chars, URL-safe):
 *   bridge_<from>_<to>_<amount>   → Bridge tab, pre-filled
 *   exchange_<from>_<to>_<amount> → Exchange tab, pre-filled
 *   otc_<from>_<to>_<amount>      → OTC tab, pre-filled
 *   order_<id>                    → Orders tab, focused on order
 *   ref_<code>                    → Capture referral code, land on Bridge
 *
 * Asset names are validated against ALLOWED_ASSETS before use.
 */
(function () {

  var ALLOWED_ASSETS = [
    'ton', 'tonbsc', 'btc', 'eth', 'usdt', 'usdtton', 'usdtbsc',
    'bnb', 'trx', 'sol', 'near', 'eos', 'algo', 'matic', 'dot',
    'op', 'avax', 'xmr', 'ltc', 'xrp', 'ada', 'doge',
  ];

  var AMOUNT_RE = /^\d+(\.\d+)?$/;
  var ORDER_ID_RE = /^[\w-]{1,64}$/;
  var REF_CODE_RE = /^[A-Za-z0-9]{4,16}$/;

  /**
   * Parse a start_param string.
   *
   * @param {string} param
   * @returns {{ type: string, [key: string]: string } | null}
   */
  function parseDeepLink(param) {
    if (!param || typeof param !== 'string') return null;
    if (param.length > 64) return null;

    var parts = param.split('_');

    if (parts[0] === 'bridge' && parts.length >= 4) {
      return _parseWidgetLink('bridge', parts);
    }
    if (parts[0] === 'exchange' && parts.length >= 4) {
      return _parseWidgetLink('exchange', parts);
    }
    if (parts[0] === 'otc' && parts.length >= 4) {
      return _parseWidgetLink('otc', parts);
    }
    if (parts[0] === 'order' && parts.length === 2) {
      return _parseOrderLink(parts);
    }
    if (parts[0] === 'ref' && parts.length === 2) {
      return _parseRefLink(parts);
    }

    return null;
  }

  function _parseWidgetLink(type, parts) {
    // parts = [type, from, to, amount]
    // Allow compound asset names like "usdtton" — they contain no underscores,
    // so the split is always exactly 4 parts for a valid link.
    var from = parts[1];
    var to = parts[2];
    var amount = parts[3];

    if (!_isAllowedAsset(from)) return null;
    if (!_isAllowedAsset(to)) return null;
    if (!AMOUNT_RE.test(amount)) return null;

    return { type: type, from: from, to: to, amount: amount };
  }

  function _parseOrderLink(parts) {
    var id = parts[1];
    if (!ORDER_ID_RE.test(id)) return null;
    return { type: 'order', id: id };
  }

  function _parseRefLink(parts) {
    var code = parts[1];
    if (!REF_CODE_RE.test(code)) return null;
    return { type: 'ref', code: code };
  }

  function _isAllowedAsset(name) {
    return ALLOWED_ASSETS.indexOf(name) !== -1;
  }

  /**
   * Build a t.me deep-link URL.
   *
   * @param {string} startParam  Already-formatted start_param value.
   * @returns {string}
   */
  function buildDeepLinkUrl(startParam) {
    return 'https://t.me/TONBridge_robot/app?startapp=' + encodeURIComponent(startParam);
  }

  /**
   * Apply a parsed deep-link to the current page.
   * Redirects when the link targets a different tab.
   * When on the correct page, updates the iframe src.
   *
   * @param {{ type: string, [key: string]: string }} link
   * @param {string} currentPage  'bridge' | 'exchange' | 'otc'
   */
  function applyDeepLink(link, currentPage) {
    if (!link) return;

    var tabMap = {
      bridge: 'index',
      exchange: 'index2',
      otc: 'index3',
      order: 'index',
    };

    var targetTab = tabMap[link.type] || 'index';

    if (link.type === 'ref') {
      // Capture referral code for future use; stay on Bridge tab.
      try {
        sessionStorage.setItem('tg_ref_code', link.code);
      } catch (e) { /* ignore */ }
      if (currentPage !== 'bridge') {
        window.location.href = 'index.html';
      }
      return;
    }

    if (link.type === 'order') {
      // Navigate to Bridge tab (order history is future work).
      if (currentPage !== 'bridge') {
        window.location.href = 'index.html';
      }
      return;
    }

    // Widget tab: bridge / exchange / otc
    var expectedPage = link.type;
    if (currentPage !== expectedPage) {
      // Redirect to the correct page preserving the param in the hash so the
      // target page can pick it up without needing server-side routing.
      window.location.href = targetTab + '.html#dl=' + encodeURIComponent(JSON.stringify(link));
      return;
    }

    _prefillWidget(link);
  }

  /**
   * Rebuild the ChangeNOW iframe src with deep-link values.
   *
   * @param {{ from: string, to: string, amount: string }} link
   */
  function _prefillWidget(link) {
    var iframe = document.getElementById('iframe-widget');
    if (!iframe) return;

    var src = iframe.src;

    src = _setQueryParam(src, 'from', link.from);
    src = _setQueryParam(src, 'to', link.to);
    src = _setQueryParam(src, 'amount', link.amount);

    iframe.src = src;
  }

  function _setQueryParam(url, key, value) {
    var re = new RegExp('([?&])' + key + '=[^&]*');
    var encoded = encodeURIComponent(value);
    if (re.test(url)) {
      return url.replace(re, '$1' + key + '=' + encoded);
    }
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return url + sep + key + '=' + encoded;
  }

  /**
   * Read start_param from Telegram.WebApp.initDataUnsafe (or from the
   * location hash for cross-tab redirects) and apply it.
   *
   * @param {string} currentPage  'bridge' | 'exchange' | 'otc'
   */
  function initDeepLink(currentPage) {
    var param = null;

    // Check cross-tab redirect payload first.
    var hash = window.location.hash;
    if (hash && hash.indexOf('#dl=') === 0) {
      try {
        var linked = JSON.parse(decodeURIComponent(hash.slice(4)));
        if (linked && linked.type) {
          // Clear the hash so a reload doesn't re-apply.
          history.replaceState(null, '', window.location.pathname + window.location.search);
          applyDeepLink(linked, currentPage);
          return;
        }
      } catch (e) { /* fall through */ }
    }

    // Read from Telegram SDK.
    try {
      var unsafe = window.Telegram && window.Telegram.WebApp &&
                   window.Telegram.WebApp.initDataUnsafe;
      param = unsafe && unsafe.start_param;
    } catch (e) { /* ignore */ }

    if (param) {
      var link = parseDeepLink(param);
      applyDeepLink(link, currentPage);
    }
  }

  window.TonBridgeDeepLink = {
    parse: parseDeepLink,
    buildUrl: buildDeepLinkUrl,
    apply: applyDeepLink,
    init: initDeepLink,
    ALLOWED_ASSETS: ALLOWED_ASSETS,
  };

})();
