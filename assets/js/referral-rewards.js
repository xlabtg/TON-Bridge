/**
 * Referral rewards frontend module.
 *
 * The page shows the user's referral deep link and the TBC reward balance from
 * the main worker ledger. Rewards are redeemed through the existing redeem page.
 */
(function () {
    'use strict';

    var DEFAULT_BOT_USERNAME = 'TONBridge_robot';
    var DEFAULT_WORKER_BASE_URL = 'https://bridge-worker.tonbankcard.workers.dev';
    var DEFAULT_POINTS_PER_TBC = 10;

    var _copiedText = 'Copied!';
    var _redeemPath = 'redeem.html';

    function _config() {
        return window.__TON_BRIDGE_CONFIG__ || {};
    }

    function _botUsername() {
        return String(_config().botUsername || DEFAULT_BOT_USERNAME).replace(/^@+/, '');
    }

    function _workerBaseUrl() {
        return String(_config().workerBaseUrl || DEFAULT_WORKER_BASE_URL).replace(/\/+$/, '');
    }

    function _tg() {
        return window.Telegram && window.Telegram.WebApp;
    }

    function _userId() {
        var tg = _tg();
        if (!tg) return null;
        try { return tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id; }
        catch (e) { return null; }
    }

    function _fallbackRefCode() {
        var uid = _userId();
        if (!uid) return null;
        return uid.toString(36).toUpperCase();
    }

    function _buildDeepLink(code) {
        return 'https://t.me/' + _botUsername() + '/app?startapp=ref_' + code;
    }

    function _showEl(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = '';
    }

    function _hideEl(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    function _setReferralLink(code) {
        var linkInput = document.getElementById('referral-link-input');
        if (!linkInput) return;
        linkInput.value = code ? _buildDeepLink(code) : '-';
    }

    function _pendingTbc(data) {
        var directPendingTbc = Number(data.pending_tbc);
        if (Number.isFinite(directPendingTbc)) {
            return Math.max(0, Math.floor(directPendingTbc));
        }

        var points = Number(data.pending_points || data.points || 0);
        var pointsPerTbc = Number(data.points_per_tbc || DEFAULT_POINTS_PER_TBC);
        if (!Number.isFinite(points) || !Number.isFinite(pointsPerTbc) || pointsPerTbc <= 0) {
            return 0;
        }
        return Math.max(0, Math.floor(points / pointsPerTbc));
    }

    function _loadReferralData() {
        var tg = _tg();
        if (!tg) {
            _hideEl('claim-loading');
            _showEl('claim-error');
            return;
        }

        var initData = tg.initData || '';
        var url = _workerBaseUrl() + '/api/referral?initData=' + encodeURIComponent(initData);

        fetch(url)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                _hideEl('claim-loading');

                if (data.ref_code) {
                    _setReferralLink(data.ref_code);
                }

                if (data.rewards_disabled) {
                    _showEl('claim-reward-disabled');
                    return;
                }

                var pending = _pendingTbc(data);
                if (pending <= 0) {
                    _showEl('claim-no-pending');
                } else {
                    var countEl = document.getElementById('pending-tbc-count');
                    if (countEl) countEl.textContent = String(pending);
                    _showEl('claim-available');
                }
            })
            .catch(function () {
                _hideEl('claim-loading');
                _showEl('claim-error');
            });
    }

    function _openRedeem() {
        window.location.href = _redeemPath;
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
        if (opts && opts.copied) _copiedText = opts.copied;
        if (opts && opts.redeemPath) _redeemPath = opts.redeemPath;

        _setReferralLink(_fallbackRefCode());

        var linkInput = document.getElementById('referral-link-input');
        var copyBtn = document.getElementById('copy-referral-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', function () {
                if (linkInput && linkInput.value && linkInput.value !== '-') {
                    _copyLink(linkInput.value);
                }
            });
        }

        var shareBtn = document.getElementById('share-referral-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', function () {
                if (linkInput && linkInput.value && linkInput.value !== '-') {
                    _shareLink(linkInput.value);
                }
            });
        }

        var claimBtn = document.getElementById('claim-reward-btn');
        if (claimBtn) {
            claimBtn.addEventListener('click', _openRedeem);
        }

        _loadReferralData();
    }

    window.ReferralRewards = { init: init };
})();
