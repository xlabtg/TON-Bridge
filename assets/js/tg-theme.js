(function () {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;

    var debounceTimer;

    function applyTheme() {
        var params = tg.themeParams || {};
        var root = document.documentElement;
        var colorScheme = tg.colorScheme || 'light';

        root.style.setProperty('--tg-color-scheme', colorScheme);

        for (var key in params) {
            if (Object.prototype.hasOwnProperty.call(params, key)) {
                root.style.setProperty('--tg-theme-' + key.replace(/_/g, '-'), params[key]);
            }
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(rebuildIframeSrc, 200);
    }

    function stripHash(hex) {
        return hex ? hex.replace(/^#/, '') : '';
    }

    function rebuildIframeSrc() {
        var iframe = document.getElementById('iframe-widget');
        if (!iframe) return;

        var params = tg.themeParams || {};
        var isDark = tg.colorScheme === 'dark';

        var primaryColor = stripHash(params.button_color || params.link_color || '#1bb2da');
        var backgroundColor = stripHash(isDark
            ? (params.bg_color || '#1c1c1e')
            : (params.bg_color || '#f6fafd'));

        var src = iframe.src;
        if (!src) return;

        var url;
        try {
            url = new URL(src);
        } catch (e) {
            return;
        }

        url.searchParams.set('primaryColor', primaryColor);
        url.searchParams.set('backgroundColor', backgroundColor);
        url.searchParams.set('darkMode', isDark ? 'true' : 'false');

        var nextSrc = url.toString();
        if (nextSrc !== iframe.src) {
            iframe.src = nextSrc;
        }
    }

    if (typeof tg.onEvent === 'function') {
        tg.onEvent('themeChanged', applyTheme);
    }
    applyTheme();
})();
