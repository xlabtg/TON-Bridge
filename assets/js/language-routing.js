// Keeps localized static page routes in sync with the user's language preference.
(function () {
    var STORAGE_KEY = 'pref:lang';
    var CLOUD_TIMEOUT_MS = 1500;
    var LOCALIZED_ROUTES = {
        'app-settings': true,
        index: true,
        index2: true,
        index3: true,
        index4: true,
        orders: true,
        privacy: true,
        program: true,
        redeem: true,
        referral: true
    };

    function normalizeLang(lang) {
        if (!lang) return null;
        var base = String(lang).toLowerCase().replace('_', '-').split('-')[0];
        if (base === 'ru') return 'ru';
        if (base === 'en') return 'en';
        return null;
    }

    function localStoredLang() {
        try {
            return normalizeLang(localStorage.getItem(STORAGE_KEY));
        } catch (e) {
            return null;
        }
    }

    function pageLang() {
        try {
            var path = window.location && window.location.pathname || '';
            if (/-ru(?:\.[a-z0-9]+)?$/i.test(path)) return 'ru';
        } catch (e) {}

        try {
            var htmlLang = normalizeLang(document.documentElement.getAttribute('lang'));
            if (htmlLang) return htmlLang;
        } catch (e) {}

        return null;
    }

    function telegramLang() {
        try {
            return normalizeLang(
                window.Telegram &&
                window.Telegram.WebApp &&
                window.Telegram.WebApp.initDataUnsafe &&
                window.Telegram.WebApp.initDataUnsafe.user &&
                window.Telegram.WebApp.initDataUnsafe.user.language_code
            );
        } catch (e) {
            return null;
        }
    }

    function cloudStorage() {
        var wa = window.Telegram && window.Telegram.WebApp;
        if (!wa || !wa.CloudStorage) return null;
        if (typeof wa.isVersionAtLeast === 'function' && !wa.isVersionAtLeast('6.1')) return null;
        return wa.CloudStorage;
    }

    function cloudStoredLang() {
        return new Promise(function (resolve) {
            var cloud = cloudStorage();
            if (!cloud || typeof cloud.getItem !== 'function') {
                resolve(null);
                return;
            }

            var done = false;
            var timer = setTimeout(function () {
                if (done) return;
                done = true;
                resolve(null);
            }, CLOUD_TIMEOUT_MS);

            try {
                cloud.getItem(STORAGE_KEY, function (err, value) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve(err ? null : normalizeLang(value));
                });
            } catch (e) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(null);
            }
        });
    }

    function preferredLang() {
        var localLang = localStoredLang();

        if (localLang) return Promise.resolve(localLang);

        return cloudStoredLang().then(function (cloudLang) {
            return cloudLang || telegramLang() || pageLang() || 'en';
        });
    }

    function localizedPath(path, lang) {
        lang = normalizeLang(lang);
        if (!path || lang !== 'ru' && lang !== 'en') return path;

        var slash = path.lastIndexOf('/');
        var dir = slash === -1 ? '' : path.slice(0, slash + 1);
        var file = slash === -1 ? path : path.slice(slash + 1);
        var match = file.match(/^(.+?)(-ru)?(\.[a-z0-9]+)$/i);
        if (!match) return path;

        var route = match[1];
        if (!LOCALIZED_ROUTES[route]) return path;

        return dir + route + (lang === 'ru' ? '-ru' : '') + match[3];
    }

    function localizedHref(href, lang) {
        if (!href || /^(?:https?:|mailto:|tel:|javascript:|#)/i.test(href)) return href;

        var parts = String(href).match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
        if (!parts) return href;

        var path = localizedPath(parts[1], lang);
        return path + (parts[2] || '') + (parts[3] || '');
    }

    function updateBottomNavLinks(lang) {
        lang = normalizeLang(lang);
        if (lang !== 'ru' && lang !== 'en') return;

        document.querySelectorAll('.appBottomMenu a[href]').forEach(function (link) {
            var original = link.getAttribute('data-lang-route-original');
            if (!original) {
                original = link.getAttribute('href');
                link.setAttribute('data-lang-route-original', original);
            }
            link.setAttribute('href', localizedHref(original, lang));
        });
    }

    function redirectCurrentPage(lang) {
        lang = normalizeLang(lang);
        if (lang !== 'ru' && lang !== 'en') return;

        try {
            var url = new URL(window.location.href);
            var localized = localizedPath(url.pathname, lang);
            if (localized && localized !== url.pathname) {
                url.pathname = localized;
                window.location.replace(url.toString());
            }
        } catch (e) {}
    }

    function applyPreferredLang(shouldRedirect) {
        preferredLang().then(function (lang) {
            updateBottomNavLinks(lang);
            if (shouldRedirect) redirectCurrentPage(lang);
        });
    }

    document.addEventListener('i18n:applied', function (event) {
        var lang = event && event.detail && normalizeLang(event.detail.lang);
        if (lang) updateBottomNavLinks(lang);
    });

    updateBottomNavLinks(localStoredLang() || pageLang() || 'en');

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            applyPreferredLang(true);
        });
    } else {
        applyPreferredLang(true);
    }

    window.TonBridgeLanguageRouting = {
        localizedHref: localizedHref,
        updateBottomNavLinks: updateBottomNavLinks,
        preferredLang: preferredLang
    };
})();
