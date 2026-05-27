// Admin panel — gated by Telegram-ID allow-list from ADMIN_TELEGRAM_IDS env var
// (injected at build time as a meta tag on the admin page).
//
// All datasets are fetched from authenticated server endpoints in the
// Cloudflare Worker (see worker/src/adminPanel.js, issue #121). The client-
// side allow-list only drives the UX fast-path; the worker is the source of
// truth and rejects anything not in env.ADMIN_TELEGRAM_IDS server-side.

(function () {
    'use strict';

    var tg = window.Telegram && window.Telegram.WebApp;

    var DEFAULT_API_BASE = 'https://ton-bridge-auth.YOUR_ACCOUNT.workers.dev';

    function publicConfig() {
        return window.__TON_BRIDGE_CONFIG__ || {};
    }

    function parseIds(raw) {
        if (Array.isArray(raw)) {
            return raw.map(String).map(function (s) { return s.trim(); }).filter(function (s) {
                return /^\d+$/.test(s);
            });
        }
        if (!raw || typeof raw !== 'string') return [];
        return raw.split(',')
            .map(function (s) { return s.trim(); })
            .filter(function (s) { return /^\d+$/.test(s); });
    }

    function getApiBase() {
        if (typeof window.__adminApiBase === 'string' && window.__adminApiBase) {
            return window.__adminApiBase;
        }
        var meta = document.querySelector('meta[name="admin-api-base"]');
        if (meta && meta.content) return meta.content;
        var config = publicConfig();
        if (config.adminApiBase) return String(config.adminApiBase);
        if (config.workerBaseUrl) return String(config.workerBaseUrl);
        if (window.location && window.location.hostname === 'localhost') {
            return 'http://localhost:8787';
        }
        return DEFAULT_API_BASE;
    }

    // ---------------------------------------------------------------------------
    // Auth gate (client-side fast-path; server is the real authority)
    // ---------------------------------------------------------------------------

    function getAllowedIds() {
        if (Array.isArray(window.__adminIds)) return parseIds(window.__adminIds);
        var config = publicConfig();
        if (Array.isArray(config.adminTelegramIds) || typeof config.adminTelegramIds === 'string') {
            return parseIds(config.adminTelegramIds);
        }
        var meta = document.querySelector('meta[name="admin-ids"]');
        if (!meta) return [];
        return parseIds(meta.content);
    }

    function getCurrentUserId() {
        if (!tg) return null;
        var user = tg.initDataUnsafe && tg.initDataUnsafe.user;
        return user ? String(user.id) : null;
    }

    function getInitData() {
        return (tg && tg.initData) || (window.__adminInitData || '');
    }

    function checkClientAccess() {
        var allowedIds = getAllowedIds();
        if (allowedIds.length === 0) return false;
        var userId = getCurrentUserId();
        return !!(userId && allowedIds.indexOf(userId) !== -1);
    }

    function show(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.hidden = false;
    }
    function hide(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.hidden = true;
    }

    // Translate a key via the runtime i18n loader, falling back to the supplied
    // English string when i18n.js has not initialised yet (or lacks the key).
    function t(key, fallback) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            var val = window.i18n.t(key, fallback);
            if (val !== undefined && val !== null) return val;
        }
        return fallback !== undefined ? fallback : key;
    }

    function showError() { show('admin-error'); }
    function hideError() { hide('admin-error'); }

    // ---------------------------------------------------------------------------
    // API client
    // ---------------------------------------------------------------------------

    function authHeader() {
        var initData = getInitData();
        return initData ? { 'Authorization': 'tma ' + initData } : {};
    }

    function apiGet(path) {
        var url = getApiBase() + path;
        return fetch(url, {
            method: 'GET',
            credentials: 'omit',
            headers: authHeader(),
        }).then(function (res) {
            if (!res.ok) throw new Error('http_' + res.status);
            return res.json();
        });
    }

    function apiPost(path, body) {
        var url = getApiBase() + path;
        var headers = { 'Content-Type': 'application/json' };
        var h = authHeader();
        if (h.Authorization) headers.Authorization = h.Authorization;
        return fetch(url, {
            method: 'POST',
            credentials: 'omit',
            headers: headers,
            body: JSON.stringify(body || {}),
        }).then(function (res) {
            if (!res.ok) throw new Error('http_' + res.status);
            return res.json();
        });
    }

    // ---------------------------------------------------------------------------
    // Rendering helpers
    // ---------------------------------------------------------------------------

    function fmt(n, decimals) {
        return Number(n).toLocaleString('en-US', {
            minimumFractionDigits: decimals || 0,
            maximumFractionDigits: decimals || 0,
        });
    }

    function setText(id, value) {
        var el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function renderStats(s) {
        setText('stat-turnover-24h', '$' + fmt(s.turnover.h24, 2));
        setText('stat-turnover-7d', '$' + fmt(s.turnover.d7, 2));
        setText('stat-turnover-30d', '$' + fmt(s.turnover.d30, 2));
        var users = s.users || {};
        setText('stat-users-total', fmt(users.total || 0));
        setText('stat-users-new-24h', fmt(users.new_24h || 0));
        setText('stat-users-new-7d', fmt(users.new_7d || 0));
        setText('stat-points-outstanding', fmt(s.points_outstanding));
        setText('stat-points-redeemed', fmt(s.points_redeemed));
        setText('stat-tbc-count', fmt(s.tbc_paid.count));
        setText('stat-tbc-total', fmt(s.tbc_paid.tbc_total) + ' TBC');
        setText('stat-tbc-usd', '$' + fmt(s.tbc_paid.usd_equiv || 0, 2));
    }

    var fraudPage = 0;
    var fraudSize = 5;
    var fraudTotal = 0;

    // Last rendered datasets, kept so the tables can be re-rendered when the
    // language changes (their dynamic cells are not covered by data-i18n).
    var lastFraud = null;
    var lastAudit = null;
    var lastRecentUsers = null;

    function renderFraudTable(items) {
        var tbody = document.getElementById('fraud-tbody');
        if (!tbody) return;
        lastFraud = items;
        tbody.innerHTML = '';
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center small">' +
                escHtml(t('admin_no_data', 'No data')) + '</td></tr>';
        } else {
            items.forEach(function (f) {
                var tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + f.id + '</td>' +
                    '<td>' + f.user_id + '</td>' +
                    '<td>' + escHtml(f.reason) + '</td>' +
                    '<td>' + fmt(f.amount_points) + '</td>' +
                    '<td>' + escHtml(formatTs(f.created_at)) + '</td>' +
                    '<td>' + (f.resolved
                        ? '<span class="badge bg-success">' + escHtml(t('admin_resolved', 'Resolved')) + '</span>'
                        : '<button class="btn btn-sm btn-outline-danger resolve-btn" data-id="' + f.id + '">' +
                            escHtml(t('admin_resolve', 'Resolve')) + '</button>') +
                    '</td>';
                tbody.appendChild(tr);
            });
        }
        var pages = Math.max(1, Math.ceil(fraudTotal / fraudSize));
        document.getElementById('fraud-page-info').textContent =
            t('admin_page_label', 'Page') + ' ' + (fraudPage + 1) + ' / ' + pages;
        document.getElementById('fraud-prev').disabled = fraudPage === 0;
        document.getElementById('fraud-next').disabled = (fraudPage + 1) * fraudSize >= fraudTotal;

        tbody.querySelectorAll('.resolve-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                resolveFlag(parseInt(btn.dataset.id, 10), btn);
            });
        });
    }

    function loadFraud() {
        return apiGet('/admin/api/fraud-flags?page=' + fraudPage + '&size=' + fraudSize)
            .then(function (data) {
                fraudTotal = Number(data.total || 0);
                renderFraudTable(data.items || []);
            });
    }

    function resolveFlag(id, btn) {
        if (btn) btn.disabled = true;
        hideError();
        apiPost('/admin/api/fraud-flags/resolve', { id: id })
            .then(function () { return loadFraud(); })
            .then(function () { return loadAuditLog(); })
            .catch(function () {
                if (btn) btn.disabled = false;
                showError();
            });
    }

    function renderTopUsers(items) {
        var tbody = document.getElementById('top-users-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center small">' +
                escHtml(t('admin_no_data', 'No data')) + '</td></tr>';
            return;
        }
        items.forEach(function (u) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + u.rank + '</td>' +
                '<td>' + u.user_id + '</td>' +
                '<td>$' + fmt(u.lifetime_usd, 2) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function loadTopUsers() {
        return apiGet('/admin/api/top-users').then(function (data) {
            renderTopUsers(data.items || []);
        });
    }

    function renderRecentUsers(items) {
        var tbody = document.getElementById('recent-users-tbody');
        if (!tbody) return;
        lastRecentUsers = items;
        tbody.innerHTML = '';
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center small">' +
                escHtml(t('admin_no_data', 'No data')) + '</td></tr>';
            return;
        }
        items.forEach(function (u) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + escHtml(String(u.user_id)) + '</td>' +
                '<td>' + escHtml(formatTs(u.created_at)) + '</td>' +
                '<td>' + fmt(u.points) + '</td>' +
                '<td>' + escHtml(formatTs(u.last_seen)) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function loadUsers() {
        return apiGet('/admin/api/users').then(function (data) {
            renderRecentUsers(data.items || []);
        });
    }

    function renderAuditLog(items) {
        var tbody = document.getElementById('audit-tbody');
        if (!tbody) return;
        lastAudit = items;
        tbody.innerHTML = '';
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center small">' +
                escHtml(t('admin_no_actions', 'No actions yet')) + '</td></tr>';
            return;
        }
        items.forEach(function (e) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + escHtml(formatTs(e.created_at)) + '</td>' +
                '<td>' + escHtml(String(e.actor_id)) + '</td>' +
                '<td>' + escHtml(e.action) + '</td>' +
                '<td>' + escHtml(JSON.stringify(e.before)) + '</td>' +
                '<td>' + escHtml(JSON.stringify(e.after)) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function loadAuditLog() {
        return apiGet('/admin/api/audit-log').then(function (data) {
            renderAuditLog(data.items || []);
        });
    }

    function loadStats() {
        return apiGet('/admin/api/stats').then(function (data) {
            renderStats(data.stats);
        });
    }

    function formatTs(unixSec) {
        if (!unixSec) return '';
        var d = new Date(Number(unixSec) * 1000);
        // ISO without ms and trailing Z, then replace T with space (parity with the previous demo output)
        return d.toISOString().slice(0, 19).replace('T', ' ');
    }

    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ---------------------------------------------------------------------------
    // Pagination controls
    // ---------------------------------------------------------------------------

    function wireControls() {
        var prevBtn = document.getElementById('fraud-prev');
        var nextBtn = document.getElementById('fraud-next');
        if (prevBtn) prevBtn.addEventListener('click', function () {
            if (fraudPage > 0) { fraudPage--; loadFraud().catch(showError); }
        });
        if (nextBtn) nextBtn.addEventListener('click', function () {
            if ((fraudPage + 1) * fraudSize < fraudTotal) {
                fraudPage++;
                loadFraud().catch(showError);
            }
        });
        var retryBtn = document.getElementById('admin-retry');
        if (retryBtn) retryBtn.addEventListener('click', function () { loadAll(); });

        // Re-render dynamic table cells when the language changes — data-i18n
        // only covers the static markup, not rows built in JS.
        document.addEventListener('i18n:applied', function () {
            if (lastFraud) renderFraudTable(lastFraud);
            if (lastAudit) renderAuditLog(lastAudit);
            if (lastRecentUsers) renderRecentUsers(lastRecentUsers);
        });
    }

    // Load every dataset; surface the error banner if any request fails.
    // Each section still renders independently on success.
    function loadAll() {
        hideError();
        return Promise.allSettled([
            loadStats(),
            loadFraud(),
            loadTopUsers(),
            loadUsers(),
            loadAuditLog(),
        ]).then(function (results) {
            var anyFailed = results.some(function (r) { return r.status === 'rejected'; });
            if (anyFailed) showError();
        });
    }

    // ---------------------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------------------

    function boot() {
        if (tg) {
            tg.ready();
            tg.expand();
            tg.onEvent('themeChanged', function () {
                document.documentElement.className = tg.colorScheme;
            });
            tg.setHeaderColor('secondary_bg_color');
            if (tg.BackButton) {
                tg.BackButton.onClick(function () { window.history.go(-1); });
                tg.BackButton.show();
            }
        }

        if (!checkClientAccess()) {
            show('access-denied');
            hide('admin-content');
            return;
        }

        hide('access-denied');
        show('admin-content');
        wireControls();

        // Kick off all loads; the error banner surfaces any failure and the
        // Retry button re-runs them.
        loadAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
