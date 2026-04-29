// Telegram BackButton helper — shows the system back button and registers a
// single click handler.  Call wireBackButton(fn) on secondary screens;
// call unwireBackButton() (returned by wireBackButton) when leaving.
(function () {
    var tg = window.Telegram && window.Telegram.WebApp;
    var _handler = null;

    function wireBackButton(onBack) {
        if (!tg || !tg.BackButton) return function () {};

        // Remove any previously registered handler before adding a new one to
        // prevent duplicate firings when the same page is visited more than once.
        if (_handler) {
            tg.BackButton.offClick(_handler);
        }

        _handler = onBack || function () { window.history.go(-1); };
        tg.BackButton.onClick(_handler);
        tg.BackButton.show();

        return function unwire() {
            if (_handler) {
                tg.BackButton.offClick(_handler);
                _handler = null;
            }
            tg.BackButton.hide();
        };
    }

    function hideBackButton() {
        if (!tg || !tg.BackButton) return;
        if (_handler) {
            tg.BackButton.offClick(_handler);
            _handler = null;
        }
        tg.BackButton.hide();
    }

    window.wireBackButton = wireBackButton;
    window.hideBackButton = hideBackButton;
})();
