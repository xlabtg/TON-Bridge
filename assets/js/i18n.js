// Runtime i18n loader — detects language, loads locale data, applies translations.
// Locale data is embedded inline via window.__i18nData (set by the build step).
// Usage: call i18n.init() on page load; call i18n.setLang(code) to switch at runtime.

(function () {
    var STORAGE_KEY = 'pref:lang';
    var _translations = {};
    var _lang = 'en';

    function localeData() {
        return window.__i18nData || {};
    }

    function supportedLocales() {
        var keys = Object.keys(localeData());
        return keys.length ? keys : ['en'];
    }

    function defaultLang() {
        var supported = supportedLocales();
        return supported.indexOf('en') !== -1 ? 'en' : (supported[0] || 'en');
    }

    function resolveSupported(lang) {
        if (!lang) return null;
        var supported = supportedLocales();
        var normalized = String(lang).toLowerCase().replace('_', '-');
        var base = normalized.split('-')[0];

        if (supported.indexOf(normalized) !== -1) return normalized;
        if (supported.indexOf(base) !== -1) return base;
        return null;
    }

    function readStoredLang() {
        if (window.prefs && typeof window.prefs.get === 'function') {
            return window.prefs.get(STORAGE_KEY).catch(function () { return null; });
        }

        try {
            return Promise.resolve(localStorage.getItem(STORAGE_KEY));
        } catch (e) {}
        return Promise.resolve(null);
    }

    function pageLang() {
        try {
            var path = window.location && window.location.pathname || '';
            var match = path.match(/-([a-z]{2})(?:\.[a-z0-9]+)?$/i);
            var pathLang = match && resolveSupported(match[1]);
            if (pathLang) return pathLang;
        } catch (e) {}

        try {
            var htmlLang = resolveSupported(document.documentElement.getAttribute('lang'));
            if (htmlLang && htmlLang !== defaultLang()) return htmlLang;
        } catch (e) {}

        return null;
    }

    function writeStoredLang(lang) {
        if (window.prefs && typeof window.prefs.set === 'function') {
            return window.prefs.set(STORAGE_KEY, lang).catch(function () {
                try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
            });
        }

        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
        return Promise.resolve();
    }

    function detectLang() {
        return readStoredLang().then(function (stored) {
            var storedLang = resolveSupported(stored);
            if (storedLang) return storedLang;

            // 2. Explicit localized page, e.g. index-ru.html.
            var routeLang = pageLang();
            if (routeLang) return routeLang;

            // 3. Telegram WebApp user language
            try {
                var tgLang = window.Telegram &&
                    window.Telegram.WebApp &&
                    window.Telegram.WebApp.initDataUnsafe &&
                    window.Telegram.WebApp.initDataUnsafe.user &&
                    window.Telegram.WebApp.initDataUnsafe.user.language_code;
                var resolvedTgLang = resolveSupported(tgLang);
                if (resolvedTgLang) return resolvedTgLang;
                if (tgLang) return defaultLang();
            } catch (e) {}

            // 4. Browser language
            try {
                var nav = navigator.language || navigator.userLanguage || '';
                var resolvedNavLang = resolveSupported(nav);
                if (resolvedNavLang) return resolvedNavLang;
            } catch (e) {}

            // 5. Default
            return defaultLang();
        }).catch(function () {
            return defaultLang();
        });
    }

    function translationsFor(lang) {
        var data = localeData();
        var fallback = data.en || {};
        var current = data[lang] || fallback;
        return Object.assign({}, fallback, current);
    }

    function fetchTranslations(lang) {
        var fallbackPromise = fetch('assets/i18n/en.json')
            .then(function (r) { return r.json(); })
            .catch(function () { return {}; });

        var currentPromise = lang === 'en'
            ? Promise.resolve({})
            : fetch('assets/i18n/' + lang + '.json')
                .then(function (r) { return r.json(); })
                .catch(function () { return {}; });

        return Promise.all([fallbackPromise, currentPromise]).then(function (locales) {
            return Object.assign({}, locales[0], locales[1]);
        });
    }

    function updateIframeLang(el, lang) {
        var src = el.getAttribute('src');
        if (!src || !lang) return;

        try {
            var url = new URL(src, window.location.href);
            url.searchParams.set('lang', lang);
            el.setAttribute('src', url.toString());
        } catch (e) {}
    }

    function applyTranslations(translations) {
        var t = translations || _translations;

        // Update <html lang="...">
        document.documentElement.lang = t.lang_attr || _lang;

        // Text content: data-i18n="key"
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            var key = el.getAttribute('data-i18n');
            if (t[key] !== undefined) el.textContent = t[key];
        });

        // HTML content: data-i18n-html="key"
        document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-html');
            if (t[key] !== undefined) el.innerHTML = t[key];
        });

        // Attributes: data-i18n-attr="attrName:key"
        document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
            var parts = el.getAttribute('data-i18n-attr').split(':');
            if (parts.length === 2 && t[parts[1]] !== undefined) {
                el.setAttribute(parts[0], t[parts[1]]);
            }
        });

        // ChangeNOW iframe language: data-i18n-iframe-lang="key"
        document.querySelectorAll('[data-i18n-iframe-lang]').forEach(function (el) {
            var key = el.getAttribute('data-i18n-iframe-lang');
            if (t[key] !== undefined) updateIframeLang(el, t[key]);
        });

        // Dispatch so other scripts (e.g. MainButton) can react
        document.dispatchEvent(new CustomEvent('i18n:applied', { detail: { lang: _lang, t: t } }));
    }

    function loadAndApply(lang) {
        lang = resolveSupported(lang) || defaultLang();

        // Use inline data embedded by the build step when available
        if (window.__i18nData && window.__i18nData[lang]) {
            _translations = translationsFor(lang);
            _lang = lang;
            applyTranslations(_translations);
            return Promise.resolve(_translations);
        }

        // Fallback: fetch from assets/i18n/
        return fetchTranslations(lang)
            .then(function (data) {
                _translations = data;
                _lang = lang;
                applyTranslations(data);
                return data;
            });
    }

    function setLang(lang) {
        lang = resolveSupported(lang) || defaultLang();
        return writeStoredLang(lang).then(function () {
            return loadAndApply(lang);
        });
    }

    function init() {
        return detectLang().then(function (lang) {
            return loadAndApply(lang);
        });
    }

    window.i18n = {
        init: init,
        setLang: setLang,
        applyTranslations: applyTranslations,
        getLang: function () { return _lang; },
        getTranslations: function () { return _translations; },
        t: function (key, fallback) {
            if (_translations[key] !== undefined) return _translations[key];
            var en = localeData().en || {};
            if (en[key] !== undefined) return en[key];
            return fallback;
        },
    };
})();
