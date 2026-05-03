/**
 * Stars Referral Program — frontend module.
 *
 * Responsibilities:
 *  1. Build the referral deep-link from the user's Telegram ID.
 *  2. Copy / share the link via Telegram.WebApp APIs.
 *  3. Query the Stars-rebate backend for pending Stars.
 *  4. Open the Telegram invoice (openInvoice) so the user can claim Stars.
 *
 * Constants (tunable via backend env vars — mirrored here for display only):
 *   STARS_REBATE_BPS    = 10   (0.10 % of USD turnover)
 *   STAR_USD_VALUE      = 0.013
 *   DAILY_STARS_CAP     = 5000
 *
 * Backend endpoint (Cloudflare Worker — see worker/stars-rebate.js):
 *   GET  /api/referral?initData=<encoded>   → { ref_code, pending_stars, stars_disabled }
 *   POST /api/referral/claim                → { invoice_url }   (Stars sendInvoice)
 */
(function () {
    'use strict';

    var BOT_USERNAME = 'TONBridge_robot';
    var BACKEND_URL = 'https://bridge-worker.tonbankcard.workers.dev';

    var _lang = 'en';
    var _copiedText = 'Copied!';

    function _tg() {
        return window.Telegram && window.Telegram.WebApp;
    }

    function _userId() {
        var tg = _tg();
        if (!tg) return null;
        try { return tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id; }
        catch (e) { return null; }
    }

    function _refCode() {
        var uid = _userId();
        if (!uid) return null;
        // Deterministic short code: base36 of telegram user id (max 10 chars).
        return uid.toString(36).toUpperCase();
    }

    function _buildDeepLink(code) {
        return 'https://t.me/' + BOT_USERNAME + '/app?startapp=ref_' + code;
    }

    function _showEl(id) { var el = document.getElementById(id); if (el) el.style.display = ''; }
    function _hideEl(id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; }

    function _loadReferralData() {
        var tg = _tg();
        if (!tg) {
            _hideEl('claim-loading');
            _showEl('claim-error');
            return;
        }

        var initData = tg.initData || '';
        var url = BACKEND_URL + '/api/referral?initData=' + encodeURIComponent(initData);

        fetch(url)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                _hideEl('claim-loading');
                if (data.stars_disabled) {
                    _showEl('claim-stars-disabled');
                    return;
                }
                var pending = data.pending_stars || 0;
                if (pending <= 0) {
                    _showEl('claim-no-pending');
                } else {
                    var countEl = document.getElementById('pending-stars-count');
                    if (countEl) countEl.textContent = pending;
                    _showEl('claim-available');
                }
            })
            .catch(function () {
                _hideEl('claim-loading');
                _showEl('claim-error');
            });
    }

    function _claimStars() {
        var tg = _tg();
        if (!tg) return;

        var initData = tg.initData || '';
        var url = BACKEND_URL + '/api/referral/claim';

        // Disable button while request is in-flight
        var btn = document.getElementById('claim-stars-btn');
        if (btn) btn.disabled = true;

        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ initData: initData }),
        })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (data.invoice_url) {
                    // Open Telegram's native Stars payment sheet
                    tg.openInvoice(data.invoice_url, function (status) {
                        if (status === 'paid') {
                            _hideEl('claim-available');
                            _showEl('claim-no-pending');
                            if (tg.HapticFeedback) {
                                tg.HapticFeedback.notificationOccurred('success');
                            }
                        } else {
                            if (btn) btn.disabled = false;
                        }
                    });
                } else {
                    if (btn) btn.disabled = false;
                }
            })
            .catch(function () {
                if (btn) btn.disabled = false;
            });
    }

    function _copyLink(link) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(function () {
                _flashCopied();
            });
        } else {
            var el = document.getElementById('referral-link-input');
            if (el) { el.select(); document.execCommand('copy'); }
            _flashCopied();
        }
        var tg = _tg();
        if (tg && tg.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }

    function _flashCopied() {
        var btn = document.getElementById('copy-referral-btn');
        if (!btn) return;
        var original = btn.innerHTML;
        btn.innerHTML = '<ion-icon name="checkmark-outline"></ion-icon> ' + _copiedText;
        btn.disabled = true;
        setTimeout(function () {
            btn.innerHTML = original;
            btn.disabled = false;
        }, 2000);
    }

    function _shareLink(link) {
        var tg = _tg();
        if (tg && tg.shareUrl) {
            tg.shareUrl(link);
        } else if (navigator.share) {
            navigator.share({ url: link });
        } else {
            _copyLink(link);
        }
    }

    function init(opts) {
        if (opts && opts.lang) _lang = opts.lang;
        if (opts && opts.copied) _copiedText = opts.copied;

        var code = _refCode();
        var linkInput = document.getElementById('referral-link-input');
        if (linkInput) {
            if (code) {
                var deepLink = _buildDeepLink(code);
                linkInput.value = deepLink;
            } else {
                linkInput.value = '—';
            }
        }

        var copyBtn = document.getElementById('copy-referral-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', function () {
                if (linkInput && linkInput.value && linkInput.value !== '—') {
                    _copyLink(linkInput.value);
                }
            });
        }

        var shareBtn = document.getElementById('share-referral-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', function () {
                if (linkInput && linkInput.value && linkInput.value !== '—') {
                    _shareLink(linkInput.value);
                }
            });
        }

        var claimBtn = document.getElementById('claim-stars-btn');
        if (claimBtn) {
            claimBtn.addEventListener('click', _claimStars);
        }

        _loadReferralData();
    }

    window.StarsReferral = { init: init };
})();
