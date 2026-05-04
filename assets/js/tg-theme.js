(function () {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) return;

    var debounceTimer;
    var fallbackThemeParams = {
        light: {
            bg_color: '#ffffff',
            text_color: '#000000',
            hint_color: '#999999',
            link_color: '#6236ff',
            button_color: '#1bb2da',
            button_text_color: '#ffffff',
            secondary_bg_color: '#ededf5',
            header_bg_color: '#ffffff',
            accent_text_color: '#6236ff',
            section_bg_color: '#ffffff',
            section_header_text_color: '#999999',
            section_separator_color: 'rgba(0, 0, 0, 0.12)',
            subtitle_text_color: '#999999',
            destructive_text_color: '#ff396f',
            bottom_bar_bg_color: '#ffffff'
        },
        dark: {
            bg_color: '#030108',
            text_color: '#ffffff',
            hint_color: '#8f82a5',
            link_color: '#1bb2da',
            button_color: '#1bb2da',
            button_text_color: '#ffffff',
            secondary_bg_color: '#161129',
            header_bg_color: '#161129',
            accent_text_color: '#1bb2da',
            section_bg_color: '#161129',
            section_header_text_color: '#8f82a5',
            section_separator_color: '#2d1f3b',
            subtitle_text_color: '#8f82a5',
            destructive_text_color: '#ff396f',
            bottom_bar_bg_color: '#161129'
        }
    };

    function copyThemeParams(source, target) {
        for (var key in source) {
            if (
                Object.prototype.hasOwnProperty.call(source, key) &&
                source[key] !== undefined &&
                source[key] !== null &&
                source[key] !== ''
            ) {
                target[key] = source[key];
            }
        }
    }

    function currentTheme() {
        var colorScheme = tg.colorScheme === 'dark' ? 'dark' : 'light';
        var params = {};
        copyThemeParams(fallbackThemeParams[colorScheme], params);
        copyThemeParams(tg.themeParams || {}, params);
        return {
            colorScheme: colorScheme,
            params: params
        };
    }

    function applyTheme() {
        var theme = currentTheme();
        var params = theme.params;
        var root = document.documentElement;

        root.style.setProperty('--tg-color-scheme', theme.colorScheme);

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

        var theme = currentTheme();
        var params = theme.params;
        var isDark = theme.colorScheme === 'dark';

        var primaryColor = stripHash(params.button_color || params.link_color || '#1bb2da');
        var backgroundColor = stripHash(params.bg_color);

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
