// Referral code module for TON Bridge.
//
// Alphabet excludes visually ambiguous characters: 0, O, 1, I, L.
// Code is 8 chars, generated via CSPRNG, stored in Telegram CloudStorage.
(function () {
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var CODE_LEN = 8;
  var STORAGE_KEY = 'ref_code';
  var BOT_USERNAME = 'TONBridge_robot';
  var APP_NAME = 'app';

  function generateCode() {
    var bytes = new Uint8Array(CODE_LEN);
    crypto.getRandomValues(bytes);
    var code = '';
    for (var i = 0; i < CODE_LEN; i++) {
      code += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return code;
  }

  function shareUrl(code) {
    return 'https://t.me/' + BOT_USERNAME + '/' + APP_NAME + '?startapp=ref_' + code;
  }

  // Load the user's ref code from CloudStorage; generate and persist if absent.
  // cb(err, code) — called with the code string on success.
  function loadOrCreate(cb) {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.CloudStorage) {
      // Fallback: generate an ephemeral code (no persistence without CloudStorage).
      cb(null, generateCode());
      return;
    }
    tg.CloudStorage.getItem(STORAGE_KEY, function (err, stored) {
      if (!err && stored) {
        cb(null, stored);
        return;
      }
      var code = generateCode();
      tg.CloudStorage.setItem(STORAGE_KEY, code, function (setErr) {
        cb(setErr || null, code);
      });
    });
  }

  // Render the referral section into the element with id="referral-section".
  // Expects i18n strings on window.__referralI18n: { code_label, url_label, share_btn, copied }.
  function renderSection(code) {
    var section = document.getElementById('referral-section');
    if (!section) return;

    var url = shareUrl(code);
    var i18n = window.__referralI18n || {};

    var codeLabel = i18n.code_label || 'Your referral code';
    var urlLabel = i18n.url_label || 'Share link';
    var shareBtnText = i18n.share_btn || 'Invite friends';
    var copiedText = i18n.copied || 'Copied!';

    section.innerHTML =
      '<div class="listview-title mt-1">' + codeLabel + '</div>' +
      '<ul class="listview image-listview text inset no-line">' +
        '<li>' +
          '<div class="item">' +
            '<div class="in">' +
              '<div>' +
                '<span id="ref-code-display" style="font-family:monospace;font-size:1.2em;letter-spacing:0.1em">' + code + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</li>' +
      '</ul>' +
      '<div class="listview-title mt-1">' + urlLabel + '</div>' +
      '<ul class="listview image-listview text inset no-line">' +
        '<li>' +
          '<div class="item">' +
            '<div class="in">' +
              '<div style="word-break:break-all;font-size:0.85em">' + url + '</div>' +
            '</div>' +
          '</div>' +
        '</li>' +
      '</ul>' +
      '<div class="p-2">' +
        '<button id="ref-share-btn" class="btn btn-primary btn-block">' +
          '<ion-icon name="share-social-outline"></ion-icon> ' + shareBtnText +
        '</button>' +
        '<button id="ref-copy-btn" class="btn btn-secondary btn-block mt-1">' +
          '<ion-icon name="copy-outline"></ion-icon> ' + (i18n.copy_btn || 'Copy link') +
        '</button>' +
        '<span id="ref-copied-msg" style="display:none;color:green;margin-left:8px">' + copiedText + '</span>' +
      '</div>';

    document.getElementById('ref-share-btn').addEventListener('click', function () {
      var tg = window.Telegram && window.Telegram.WebApp;
      var shareText = (i18n.share_text || 'Try TON Bridge:') + ' ' + url;
      var telegramShareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(url) +
        '&text=' + encodeURIComponent(shareText);
      if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(telegramShareUrl);
      } else {
        window.open(telegramShareUrl, '_blank');
      }
    });

    document.getElementById('ref-copy-btn').addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          showCopied();
        });
      } else {
        var el = document.createElement('textarea');
        el.value = url;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showCopied();
      }
    });

    function showCopied() {
      var msg = document.getElementById('ref-copied-msg');
      if (!msg) return;
      msg.style.display = 'inline';
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
      }
      setTimeout(function () { msg.style.display = 'none'; }, 2000);
    }
  }

  // Public API
  window.ReferralModule = {
    generateCode: generateCode,
    shareUrl: shareUrl,
    loadOrCreate: loadOrCreate,
    init: function () {
      loadOrCreate(function (err, code) {
        if (err) {
          console.error('[referral] failed to load/create code:', err);
          return;
        }
        renderSection(code);
      });
    },
  };
})();
