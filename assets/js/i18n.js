// Runtime i18n loader — detects language, loads locale data, applies translations.
// Locale data is embedded inline via window.__i18nData (set by the build step).
// Usage: call i18n.init() on page load; call i18n.setLang(code) to switch at runtime.

(function () {
    var STORAGE_KEY = 'pref:lang';
    var SUPPORTED = ['en', 'ru'];
    var _translations = {};
    var _lang = 'en';

    function detectLang() {
        // 1. Stored preference
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored && SUPPORTED.indexOf(stored) !== -1) return stored;
        } catch (e) {}

        // 2. Telegram WebApp user language
        try {
            var tgLang = window.Telegram &&
                window.Telegram.WebApp &&
                window.Telegram.WebApp.initDataUnsafe &&
                window.Telegram.WebApp.initDataUnsafe.user &&
                window.Telegram.WebApp.initDataUnsafe.user.language_code;
            if (tgLang) return tgLang.startsWith('ru') ? 'ru' : 'en';
        } catch (e) {}

        // 3. Browser language
        try {
            var nav = navigator.language || navigator.userLanguage || '';
            if (nav.startsWith('ru')) return 'ru';
        } catch (e) {}

        // 4. Default
        return 'en';
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

        // Dispatch so other scripts (e.g. MainButton) can react
        document.dispatchEvent(new CustomEvent('i18n:applied', { detail: { lang: _lang, t: t } }));
    }

    function loadAndApply(lang) {
        // Use inline data embedded by the build step when available
        if (window.__i18nData && window.__i18nData[lang]) {
            _translations = window.__i18nData[lang];
            _lang = lang;
            applyTranslations(_translations);
            return Promise.resolve(_translations);
        }
        // Fallback: fetch from assets/i18n/
        return fetch('assets/i18n/' + lang + '.json')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _translations = data;
                _lang = lang;
                applyTranslations(data);
                return data;
            });
    }

    function setLang(lang) {
        if (SUPPORTED.indexOf(lang) === -1) lang = 'en';
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
        return loadAndApply(lang);
    }

    function init() {
        _lang = detectLang();
        return loadAndApply(_lang);
    }

    window.i18n = {
        init: init,
        setLang: setLang,
        applyTranslations: applyTranslations,
        getLang: function () { return _lang; },
        getTranslations: function () { return _translations; },
    };
})();
