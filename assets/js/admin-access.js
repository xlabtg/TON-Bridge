(function () {
    'use strict';

    function parseIds(raw) {
        if (Array.isArray(raw)) {
            return raw.map(String).map(function (s) { return s.trim(); }).filter(Boolean);
        }
        if (!raw || typeof raw !== 'string') return [];
        return raw.split(',')
            .map(function (s) { return s.trim(); })
            .filter(function (s) { return /^\d+$/.test(s); });
    }

    function allowedIds() {
        if (Array.isArray(window.__adminIds)) return parseIds(window.__adminIds);

        var config = window.__TON_BRIDGE_CONFIG__;
        if (config && Array.isArray(config.adminTelegramIds)) {
            return parseIds(config.adminTelegramIds);
        }
        if (config && typeof config.adminTelegramIds === 'string') {
            return parseIds(config.adminTelegramIds);
        }

        var source = document.querySelector('[data-admin-ids]');
        if (source) return parseIds(source.getAttribute('data-admin-ids') || '');

        var meta = document.querySelector('meta[name="admin-ids"]');
        return meta ? parseIds(meta.content || '') : [];
    }

    function currentUserId() {
        if (window.__adminUserId != null) return String(window.__adminUserId);

        var tg = window.Telegram && window.Telegram.WebApp;
        var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
        return user && user.id != null ? String(user.id) : null;
    }

    function isAdmin() {
        var userId = currentUserId();
        if (!userId) return false;
        return allowedIds().indexOf(userId) !== -1;
    }

    function setAdminOnlyVisibility(el, allowed) {
        if (allowed) {
            el.hidden = false;
            el.removeAttribute('aria-hidden');
            if (el.getAttribute('tabindex') === '-1' || el.getAttribute('data-admin-only-tabstop') === 'removed') {
                el.removeAttribute('tabindex');
                el.removeAttribute('data-admin-only-tabstop');
            }
            return;
        }

        if (el.hasAttribute('tabindex')) {
            el.setAttribute('data-admin-only-tabstop', 'removed');
        }
        el.hidden = true;
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('tabindex', '-1');
    }

    function apply() {
        var allowed = isAdmin();
        document.querySelectorAll('[data-admin-only]').forEach(function (el) {
            setAdminOnlyVisibility(el, allowed);
        });
        document.documentElement.classList.toggle('is-admin-user', allowed);
        document.dispatchEvent(new CustomEvent('tonbridge:admin-access', {
            detail: { isAdmin: allowed, userId: currentUserId() }
        }));
        return allowed;
    }

    window.TonBridgeAdminAccess = {
        allowedIds: allowedIds,
        currentUserId: currentUserId,
        isAdmin: isAdmin,
        apply: apply
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
})();
