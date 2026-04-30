// Admin panel — gated by Telegram-ID allow-list from ADMIN_TELEGRAM_IDS env var
// (injected at build time as a meta tag on the admin page).
// All state is mock/demo data; hook up a real API endpoint for production.

(function () {
    'use strict';

    var tg = window.Telegram && window.Telegram.WebApp;

    // ---------------------------------------------------------------------------
    // Auth gate
    // ---------------------------------------------------------------------------

    function getAllowedIds() {
        // Allow tests to inject IDs via a global before page scripts run.
        if (Array.isArray(window.__adminIds)) return window.__adminIds;
        var meta = document.querySelector('meta[name="admin-ids"]');
        if (!meta) return [];
        return meta.content.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }

    function getCurrentUserId() {
        if (!tg) return null;
        var user = tg.initDataUnsafe && tg.initDataUnsafe.user;
        return user ? String(user.id) : null;
    }

    function checkAccess() {
        var allowedIds = getAllowedIds();
        // If no allow-list is configured, block everyone.
        if (allowedIds.length === 0) return false;
        var userId = getCurrentUserId();
        return userId && allowedIds.indexOf(userId) !== -1;
    }

    function show(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('d-none');
    }
    function hide(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.add('d-none');
    }

    // ---------------------------------------------------------------------------
    // Stats (replace with real API calls in production)
    // ---------------------------------------------------------------------------

    var MOCK_STATS = {
        turnover: { h24: 184320.50, d7: 1021440.00, d30: 4318200.75 },
        points_outstanding: 824300,
        points_redeemed: 215700,
        tbc_paid: { count: 1420, tbc_total: 21570, usd_equiv: 6.47 },
        fraud_flags: [
            { id: 1, user_id: 100001, reason: 'Multiple rapid redemptions', amount: 5000, created_at: '2026-04-28T12:34:00Z', resolved: false },
            { id: 2, user_id: 100042, reason: 'Abnormal referral volume', amount: 12000, created_at: '2026-04-29T08:11:00Z', resolved: false },
            { id: 3, user_id: 100007, reason: 'Suspected self-referral', amount: 800, created_at: '2026-04-29T17:55:00Z', resolved: true },
        ],
        top_users: [
            { rank: 1,  user_id: 100999, lifetime_usd: 98200.00 },
            { rank: 2,  user_id: 100042, lifetime_usd: 74100.50 },
            { rank: 3,  user_id: 100123, lifetime_usd: 62300.25 },
            { rank: 4,  user_id: 100888, lifetime_usd: 55000.00 },
            { rank: 5,  user_id: 100555, lifetime_usd: 48750.75 },
            { rank: 6,  user_id: 100321, lifetime_usd: 43200.00 },
            { rank: 7,  user_id: 100777, lifetime_usd: 39100.00 },
            { rank: 8,  user_id: 100654, lifetime_usd: 34900.50 },
            { rank: 9,  user_id: 100210, lifetime_usd: 31200.25 },
            { rank: 10, user_id: 100001, lifetime_usd: 28500.00 },
        ],
    };

    var AUDIT_LOG = [];

    // ---------------------------------------------------------------------------
    // Rendering helpers
    // ---------------------------------------------------------------------------

    function fmt(n, decimals) {
        return Number(n).toLocaleString('en-US', {
            minimumFractionDigits: decimals || 0,
            maximumFractionDigits: decimals || 0,
        });
    }

    function renderStats(s) {
        document.getElementById('stat-turnover-24h').textContent = '$' + fmt(s.turnover.h24, 2);
        document.getElementById('stat-turnover-7d').textContent  = '$' + fmt(s.turnover.d7, 2);
        document.getElementById('stat-turnover-30d').textContent = '$' + fmt(s.turnover.d30, 2);
        document.getElementById('stat-points-outstanding').textContent = fmt(s.points_outstanding);
        document.getElementById('stat-points-redeemed').textContent    = fmt(s.points_redeemed);
        document.getElementById('stat-tbc-count').textContent    = fmt(s.tbc_paid.count);
        document.getElementById('stat-tbc-total').textContent    = fmt(s.tbc_paid.tbc_total) + ' TBC';
        document.getElementById('stat-tbc-usd').textContent      = '$' + fmt(s.tbc_paid.usd_equiv, 2);
    }

    var fraudPage = 0;
    var FRAUD_PAGE_SIZE = 5;

    function renderFraudTable(flags) {
        var tbody = document.getElementById('fraud-tbody');
        if (!tbody) return;
        var start = fraudPage * FRAUD_PAGE_SIZE;
        var page  = flags.slice(start, start + FRAUD_PAGE_SIZE);
        tbody.innerHTML = '';
        page.forEach(function (f) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + f.id + '</td>' +
                '<td>' + f.user_id + '</td>' +
                '<td>' + escHtml(f.reason) + '</td>' +
                '<td>' + fmt(f.amount) + '</td>' +
                '<td>' + f.created_at.replace('T', ' ').replace('Z', '') + '</td>' +
                '<td>' + (f.resolved
                    ? '<span class="badge bg-success">Resolved</span>'
                    : '<button class="btn btn-sm btn-outline-danger resolve-btn" data-id="' + f.id + '">Resolve</button>') +
                '</td>';
            tbody.appendChild(tr);
        });
        document.getElementById('fraud-page-info').textContent =
            'Page ' + (fraudPage + 1) + ' / ' + Math.max(1, Math.ceil(flags.length / FRAUD_PAGE_SIZE));
        document.getElementById('fraud-prev').disabled = fraudPage === 0;
        document.getElementById('fraud-next').disabled = start + FRAUD_PAGE_SIZE >= flags.length;

        tbody.querySelectorAll('.resolve-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                resolveFlag(parseInt(btn.dataset.id, 10));
            });
        });
    }

    function resolveFlag(id) {
        var flag = MOCK_STATS.fraud_flags.find(function (f) { return f.id === id; });
        if (!flag || flag.resolved) return;
        flag.resolved = true;
        var actor = getCurrentUserId() || 'unknown';
        AUDIT_LOG.push({
            who:    actor,
            action: 'resolve_fraud_flag',
            target: id,
            before: { resolved: false },
            after:  { resolved: true },
            when:   new Date().toISOString(),
        });
        renderFraudTable(MOCK_STATS.fraud_flags);
        renderAuditLog();
    }

    function renderTopUsers(users) {
        var tbody = document.getElementById('top-users-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        users.forEach(function (u) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + u.rank + '</td>' +
                '<td>' + u.user_id + '</td>' +
                '<td>$' + fmt(u.lifetime_usd, 2) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function renderAuditLog() {
        var tbody = document.getElementById('audit-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        var entries = AUDIT_LOG.slice().reverse();
        entries.forEach(function (e) {
            var tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + escHtml(e.when.replace('T', ' ').replace('Z', '')) + '</td>' +
                '<td>' + escHtml(e.who) + '</td>' +
                '<td>' + escHtml(e.action) + '</td>' +
                '<td>' + escHtml(JSON.stringify(e.before)) + '</td>' +
                '<td>' + escHtml(JSON.stringify(e.after)) + '</td>';
            tbody.appendChild(tr);
        });
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
            if (fraudPage > 0) { fraudPage--; renderFraudTable(MOCK_STATS.fraud_flags); }
        });
        if (nextBtn) nextBtn.addEventListener('click', function () {
            if ((fraudPage + 1) * FRAUD_PAGE_SIZE < MOCK_STATS.fraud_flags.length) {
                fraudPage++;
                renderFraudTable(MOCK_STATS.fraud_flags);
            }
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

        if (!checkAccess()) {
            show('access-denied');
            hide('admin-content');
            return;
        }

        hide('access-denied');
        show('admin-content');
        renderStats(MOCK_STATS);
        renderFraudTable(MOCK_STATS.fraud_flags);
        renderTopUsers(MOCK_STATS.top_users);
        renderAuditLog();
        wireControls();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
