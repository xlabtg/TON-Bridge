// Referral rewards page module.
//
// Displays the user's referral link and TBC rewards balance from the referral
// worker endpoint. Rewards use the same points ledger as redeem.html:
// 10 points = 1 TBC.
(function () {
    'use strict';

    var WORKER_BASE = 'https://ton-bridge-worker.tonbankcard.workers.dev';
    var DEFAULT_POINTS_PER_TBC = 10;
    var _copiedText = 'Copied!';

    function config() {
        return window.__TON_BRIDGE_CONFIG__ || {};
    }

    function workerBaseUrl() {
        return String(config().workerBaseUrl || WORKER_BASE).replace(/\/+$/, '');
    }

    function tgWebApp() {
        return window.Telegram && window.Telegram.WebApp;
    }

    function showEl(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = '';
    }

    function hideEl(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    function formatNumber(value, opts) {
        try {
            return Number(value || 0).toLocaleString(undefined, opts || {});
        } catch (e) {
            return String(value || 0);
        }
    }

    function pointsPerTbc(data) {
        var value = Number(data && data.points_per_tbc);
        return Number.isFinite(value) && value > 0 ? value : DEFAULT_POINTS_PER_TBC;
    }

    function pendingPoints(data) {
        var value = Number(data && (data.pending_points || data.points || 0));
        return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    }

    function renderRewardBalance(data) {
        hideEl('reward-loading');

        var points = pendingPoints(data || {});
        if (points <= 0) {
            showEl('reward-empty');
            return;
        }

        var divisor = pointsPerTbc(data || {});
        var tbc = points / divisor;
        var pointsEl = document.getElementById('reward-points-count');
        var tbcEl = document.getElementById('reward-tbc-count');

        if (pointsEl) {
            pointsEl.textContent = formatNumber(points);
        }
        if (tbcEl) {
            tbcEl.textContent = formatNumber(tbc, {
                minimumFractionDigits: points % divisor === 0 ? 0 : 1,
                maximumFractionDigits: 1,
            });
        }

        showEl('reward-available');
    }

    function renderReferralLink(code, url) {
        var input = document.getElementById('referral-link-input');
        if (!input) return;

        if (url) {
            input.value = url;
        } else if (code && window.ReferralModule && window.ReferralModule.shareUrl) {
            input.value = window.ReferralModule.shareUrl(code);
        } else {
            input.value = '-';
        }
    }

    function loadReferralLinkFallback() {
        if (window.ReferralModule && window.ReferralModule.loadOrCreate) {
            window.ReferralModule.loadOrCreate(function (_err, code, url) {
                renderReferralLink(code, url);
            });
            return;
        }

        renderReferralLink(null, null);
    }

    function loadReferralRewards() {
        var tg = tgWebApp();
        if (!tg) {
            hideEl('reward-loading');
            showEl('reward-error');
            return;
        }

        fetch(workerBaseUrl() + '/api/referral?initData=' + encodeURIComponent(tg.initData || ''))
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                renderReferralLink(data && data.ref_code, data && data.ref_share_url);
                renderRewardBalance(data || {});
            })
            .catch(function () {
                hideEl('reward-loading');
                showEl('reward-error');
            });
    }

    function flashCopied() {
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

    function copyLink(link) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(flashCopied);
        } else {
            var input = document.getElementById('referral-link-input');
            if (input) {
                input.select();
                document.execCommand('copy');
            }
            flashCopied();
        }

        var tg = tgWebApp();
        if (tg && tg.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }

    function shareLink(link) {
        var tg = tgWebApp();
        if (tg && tg.shareUrl) {
            tg.shareUrl(link);
        } else if (navigator.share) {
            navigator.share({ url: link });
        } else {
            copyLink(link);
        }
    }

    function wireActions() {
        var input = document.getElementById('referral-link-input');
        var copyBtn = document.getElementById('copy-referral-btn');
        var shareBtn = document.getElementById('share-referral-btn');

        if (copyBtn) {
            copyBtn.addEventListener('click', function () {
                if (input && input.value && input.value !== '-') {
                    copyLink(input.value);
                }
            });
        }

        if (shareBtn) {
            shareBtn.addEventListener('click', function () {
                if (input && input.value && input.value !== '-') {
                    shareLink(input.value);
                }
            });
        }
    }

    function init(opts) {
        if (opts && opts.copied) _copiedText = opts.copied;

        loadReferralLinkFallback();
        wireActions();
        loadReferralRewards();
    }

    window.ReferralRewards = { init: init };
})();
