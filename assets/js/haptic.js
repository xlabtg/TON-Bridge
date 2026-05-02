// Thin wrapper around Telegram.WebApp.HapticFeedback.
// Degrades gracefully when run outside Telegram or on devices without haptics.
(function () {
    function safeHaptic(fn) {
        try {
            var h = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback;
            if (h) fn(h);
        } catch (e) {}
    }

    var haptic = {
        impact: function (style) {
            safeHaptic(function (h) { h.impactOccurred(style); });
        },
        notification: function (type) {
            safeHaptic(function (h) { h.notificationOccurred(type); });
        },
        selection: function () {
            safeHaptic(function (h) { h.selectionChanged(); });
        },
    };

    window.haptic = haptic;
})();
