// BiometricManager helper for Telegram Web App.
// Handles init, access request, authentication, and CloudStorage persistence.
(function () {
    var STORAGE_KEY_ENABLED = 'biometricEnabled';
    var STORAGE_KEY_THRESHOLD = 'biometricThreshold';
    var DEFAULT_THRESHOLD = 1000;

    var tg = window.Telegram && window.Telegram.WebApp;
    var bm = tg && tg.BiometricManager;
    var cs = tg && tg.CloudStorage;

    // ---- CloudStorage helpers (fall back to localStorage) ----

    function csGet(key, cb) {
        if (cs) {
            cs.getItem(key, function (err, val) { cb(err ? null : val); });
        } else {
            cb(localStorage.getItem(key));
        }
    }

    function csSet(key, val) {
        if (cs) {
            cs.setItem(key, String(val), function () {});
        } else {
            localStorage.setItem(key, String(val));
        }
    }

    // ---- Public API ----

    /**
     * Returns true when BiometricManager is available and biometrics are
     * supported on this device. Synchronous after init() completes.
     */
    function isAvailable() {
        return !!(bm && bm.isInited && bm.isBiometricAvailable);
    }

    /**
     * Read the persisted opt-in state.
     * @param {function(boolean)} cb
     */
    function isEnabled(cb) {
        csGet(STORAGE_KEY_ENABLED, function (val) {
            cb(val === '1');
        });
    }

    /**
     * Persist the opt-in state.
     * @param {boolean} enabled
     */
    function setEnabled(enabled) {
        csSet(STORAGE_KEY_ENABLED, enabled ? '1' : '0');
    }

    /**
     * Read the persisted threshold (USD). Calls cb with a number.
     * @param {function(number)} cb
     */
    function getThreshold(cb) {
        csGet(STORAGE_KEY_THRESHOLD, function (val) {
            var n = parseFloat(val);
            cb(isNaN(n) ? DEFAULT_THRESHOLD : n);
        });
    }

    /**
     * Persist the threshold value.
     * @param {number} threshold
     */
    function setThreshold(threshold) {
        csSet(STORAGE_KEY_THRESHOLD, String(threshold));
    }

    /**
     * Initialise BiometricManager. Calls cb() once ready (or immediately if
     * bm is unavailable).
     * @param {function} cb
     */
    function init(cb) {
        if (!bm) { cb(); return; }
        bm.init(function () {
            if (!bm.isAccessGranted && bm.isBiometricAvailable) {
                bm.requestAccess({ reason: 'Allow biometric confirmation for large trades' }, function () {
                    cb();
                });
            } else {
                cb();
            }
        });
    }

    /**
     * Run the biometric prompt.
     * @param {string} reason  Text shown to the user.
     * @param {function(boolean)} cb  Called with true on success, false otherwise.
     */
    function authenticate(reason, cb) {
        if (!isAvailable()) { cb(false); return; }
        bm.authenticate({ reason: reason }, function (ok) {
            cb(!!ok);
        });
    }

    /**
     * Gate an action behind the biometric prompt when the feature is enabled
     * and the amount exceeds the threshold.
     *
     * @param {number}   amount         USD-equivalent amount (or raw user amount as fallback).
     * @param {string}   reason         Prompt text.
     * @param {string}   failureMessage Toast message shown on cancel/failure.
     * @param {function} proceed        Called when the user is authenticated (or feature is off / amount below threshold).
     * @param {function} abort          Called when the user cancels or fails.
     */
    function guardTrade(amount, reason, failureMessage, proceed, abort) {
        isEnabled(function (enabled) {
            if (!enabled) { proceed(); return; }

            getThreshold(function (threshold) {
                var normalizedAmount = parseFloat(amount);
                if (isNaN(normalizedAmount) || normalizedAmount <= 0) {
                    normalizedAmount = 0;
                }

                if (normalizedAmount < threshold) { proceed(); return; }

                if (!isAvailable()) { proceed(); return; }

                authenticate(reason, function (ok) {
                    if (ok) {
                        proceed();
                    } else {
                        if (failureMessage) {
                            showBiometricToast(failureMessage);
                        }
                        if (abort) abort();
                    }
                });
            });
        });
    }

    // ---- Toast helper ----

    function showBiometricToast(message) {
        var toastId = 'biometric-toast';
        var existing = document.getElementById(toastId);
        if (existing) existing.parentNode.removeChild(existing);

        var box = document.createElement('div');
        box.id = toastId;
        box.className = 'toast-box toast-center show';
        box.style.zIndex = '9999';
        box.innerHTML =
            '<div class="in">' +
            '<div class="text"><strong>' + escapeHtml(message) + '</strong></div>' +
            '</div>';
        document.body.appendChild(box);

        setTimeout(function () {
            if (box.parentNode) box.parentNode.removeChild(box);
        }, 3500);
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    window.BiometricAuth = {
        init: init,
        isAvailable: isAvailable,
        isEnabled: isEnabled,
        setEnabled: setEnabled,
        getThreshold: getThreshold,
        setThreshold: setThreshold,
        authenticate: authenticate,
        guardTrade: guardTrade,
    };
})();
