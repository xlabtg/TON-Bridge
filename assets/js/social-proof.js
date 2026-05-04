// Social-proof widget: renders "{N} bridges in the last 24 h · ${V} volume"
// Refreshes every 60 s. Hides when count is 0 (API outage).
// Caches in sessionStorage so the value renders instantly on tab switches.
// Announces to screen readers via aria-live only on the first render of a session.
(function () {
    var CACHE_KEY = 'sp_widget_v1';
    var REFRESH_INTERVAL = 60000;
    var PILL_ID = 'social-proof-pill';
    var REGION_ID = 'social-proof-region';

    // Cap at a realistic maximum to prevent fudged upward values.
    var MAX_COUNT = 1000000;
    var MAX_VOLUME = 1000000000;

    // ChangeNOW partner stats endpoint (proxied through query param to avoid CORS).
    // The endpoint returns { count: Number, volume: Number } for the last 24 h.
    var STATS_URL = 'https://api.changenow.io/v1/info/stats?link_id=3cc0024a18fd9d';

    var _announced = sessionStorage.getItem('sp_announced') === '1';
    var _timer = null;

    function clamp(val, max) {
        return Math.min(val, max);
    }

    function formatNumber(n, locale) {
        try {
            return new Intl.NumberFormat(locale).format(n);
        } catch (e) {
            return String(n);
        }
    }

    function formatVolume(v, locale) {
        try {
            return '$' + new Intl.NumberFormat(locale, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(v);
        } catch (e) {
            return '$' + Math.round(v);
        }
    }

    function readCache() {
        try {
            var raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function writeCache(data) {
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch (e) { /* storage unavailable */ }
    }

    function getPill() {
        return document.getElementById(PILL_ID);
    }

    function getRegion() {
        return document.getElementById(REGION_ID);
    }

    function render(data, isFirstRender) {
        var pill = getPill();
        var region = getRegion();
        if (!pill || !region) return;

        var count = clamp(data.count, MAX_COUNT);
        var volume = clamp(data.volume, MAX_VOLUME);

        if (!count || count <= 0) {
            pill.hidden = true;
            return;
        }

        var locale = document.documentElement.lang || 'en';
        var countStr = formatNumber(count, locale);
        var volumeStr = formatVolume(volume, locale);

        var labelAttr = pill.getAttribute('data-label-template') || '{count} bridges · {volume}';
        var text = labelAttr
            .replace('{count}', countStr)
            .replace('{volume}', volumeStr);

        pill.querySelector('.sp-text').textContent = text;
        pill.hidden = false;

        // Announce only on first render per session.
        if (isFirstRender && !_announced) {
            region.textContent = text;
            _announced = true;
            try { sessionStorage.setItem('sp_announced', '1'); } catch (e) {}
        }
    }

    function fetchStats(onDone) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', STATS_URL, true);
        xhr.timeout = 10000;
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (typeof data.count === 'number' && typeof data.volume === 'number') {
                        onDone(null, data);
                        return;
                    }
                } catch (e) { /* fall through */ }
            }
            onDone(new Error('fetch failed'));
        };
        xhr.onerror = function () { onDone(new Error('network error')); };
        xhr.ontimeout = function () { onDone(new Error('timeout')); };
        xhr.send();
    }

    function refresh(isFirstRender) {
        fetchStats(function (err, data) {
            if (!err && data) {
                writeCache(data);
                render(data, isFirstRender);
            }
            // On error: keep cached value visible, don't hide.
        });
    }

    function init() {
        var pill = getPill();
        if (!pill) return; // Not present on this page.

        // Render cached value immediately (instant on tab switch).
        var cached = readCache();
        if (cached) {
            render(cached, false);
        }

        // First live fetch.
        refresh(true);

        // Schedule periodic refresh.
        _timer = setInterval(function () { refresh(false); }, REFRESH_INTERVAL);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
