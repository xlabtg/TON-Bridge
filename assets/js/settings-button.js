// Telegram SettingsButton helper — shows the system settings button and routes
// its click to the settings page.  Call wireSettingsButton(url) on non-settings
// screens; call hideSettingsButton() on the settings screen itself.
(function () {
    var tg = window.Telegram && window.Telegram.WebApp;
    var _handler = null;

    function wireSettingsButton(settingsUrl) {
        if (!tg || !tg.SettingsButton) return;

        var url = settingsUrl || 'app-settings.html';

        if (_handler) {
            tg.SettingsButton.offClick(_handler);
        }

        _handler = function () { window.location.href = url; };
        tg.SettingsButton.onClick(_handler);
        tg.SettingsButton.show();
    }

    function hideSettingsButton() {
        if (!tg || !tg.SettingsButton) return;
        if (_handler) {
            tg.SettingsButton.offClick(_handler);
            _handler = null;
        }
        tg.SettingsButton.hide();
    }

    window.wireSettingsButton = wireSettingsButton;
    window.hideSettingsButton = hideSettingsButton;
})();
