// TonConnect 2 wallet integration using the self-hosted @tonconnect/ui build.
// Exposes window.WalletConnect for use in page templates.

(function () {
    var STORAGE_KEY = 'tc_ton_address';
    var PAYOUT_STORAGE_KEY = 'tbc_ton_address';
    var PAYOUT_RATE_LIMIT_KEY = 'tbc_ton_address_updated_at';
    var DAY_MS = 864e5;
    var TONCENTER_BASE = 'https://toncenter.com/api/v2/getAddressInformation?address=';

    var _ui = null;              // TonConnectUI instance
    var _manifestUrl = null;
    var _sdkUrl = null;
    var _sdkLoading = null;
    var _listeners = [];         // callbacks registered by page code

    // ---------- helpers ----------

    function shortenAddress(addr) {
        if (!addr || addr.length < 12) return addr;
        return addr.slice(0, 6) + '…' + addr.slice(-4);
    }

    function nanoToTon(nano) {
        return (parseInt(nano, 10) / 1e9).toFixed(2);
    }

    function saveAddress(addr) {
        try {
            var tg = window.Telegram && window.Telegram.WebApp;
            if (tg && tg.CloudStorage) {
                tg.CloudStorage.setItem(STORAGE_KEY, addr || '', function () {});
            } else {
                localStorage.setItem(STORAGE_KEY, addr || '');
            }
        } catch (_) {}
    }

    function getStoredPayoutAddress() {
        return localStorage.getItem(PAYOUT_STORAGE_KEY) || '';
    }

    function savePayoutAddress(addr) {
        localStorage.setItem(PAYOUT_STORAGE_KEY, addr || '');
        localStorage.setItem(PAYOUT_RATE_LIMIT_KEY, String(Date.now()));
    }

    function removePayoutAddress() {
        localStorage.removeItem(PAYOUT_STORAGE_KEY);
        localStorage.removeItem(PAYOUT_RATE_LIMIT_KEY);
    }

    function isPayoutReplaceRateLimited() {
        var ts = parseInt(localStorage.getItem(PAYOUT_RATE_LIMIT_KEY) || '0', 10);
        return ts > 0 && (Date.now() - ts) < DAY_MS;
    }

    function looksLikeExchangeAddress(addr) {
        return !!addr && (
            addr.indexOf('EQBfAN7LfaUYgXZNw5Wc7GBgkEX2yhuJ5ka9X9V7M') === 0 ||
            addr.indexOf('EQCzL4bHKkTfn9e5rW0') === 0
        );
    }

    function loadAddress(cb) {
        try {
            var tg = window.Telegram && window.Telegram.WebApp;
            if (tg && tg.CloudStorage) {
                tg.CloudStorage.getItem(STORAGE_KEY, function (err, val) {
                    cb(err ? null : val);
                });
            } else {
                cb(localStorage.getItem(STORAGE_KEY));
            }
        } catch (_) {
            cb(null);
        }
    }

    function fetchBalance(addr, cb) {
        var url = TONCENTER_BASE + encodeURIComponent(addr);
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var nano = data && data.result && data.result.balance;
                cb(nano != null ? nanoToTon(nano) : null);
            })
            .catch(function () { cb(null); });
    }

    function notifyListeners(state) {
        for (var i = 0; i < _listeners.length; i++) {
            try { _listeners[i](state); } catch (_) {}
        }
    }

    function notifyPayoutLinked(addr) {
        window.dispatchEvent(new CustomEvent('tbc:wallet-linked', { detail: { address: addr } }));
    }

    function confirmReplacePayout(message, cb) {
        var tg = window.Telegram && window.Telegram.WebApp;
        if (tg && tg.showConfirm) {
            tg.showConfirm(message, cb);
        } else {
            cb(confirm(message));
        }
    }

    function setPayoutAddress(addr, options) {
        options = options || {};
        addr = (addr || '').trim();
        if (!addr) return false;

        var stored = getStoredPayoutAddress();
        if (stored && stored !== addr) {
            if (isPayoutReplaceRateLimited()) {
                alert(options.rateLimitError || 'You can replace your payout address only once every 24 hours.');
                return false;
            }
            confirmReplacePayout(options.replaceConfirm || 'Replace existing payout address?', function (ok) {
                if (ok) {
                    savePayoutAddress(addr);
                    notifyPayoutLinked(addr);
                }
            });
            return true;
        }

        savePayoutAddress(addr);
        notifyPayoutLinked(addr);
        return true;
    }

    function loadSdk(cb) {
        if (window.TON_CONNECT_UI && window.TON_CONNECT_UI.TonConnectUI) {
            cb();
            return;
        }

        if (!_sdkUrl) {
            console.warn('TonConnectUI SDK URL is not configured');
            return;
        }

        if (_sdkLoading) {
            _sdkLoading.push(cb);
            return;
        }

        _sdkLoading = [cb];
        var script = document.createElement('script');
        script.src = _sdkUrl;
        script.async = true;
        script.onload = function () {
            var callbacks = _sdkLoading || [];
            _sdkLoading = null;
            for (var i = 0; i < callbacks.length; i++) callbacks[i]();
        };
        script.onerror = function () {
            _sdkLoading = null;
            console.warn('TonConnectUI failed to load');
        };
        document.head.appendChild(script);
    }

    function ensureUi(cb) {
        if (_ui) {
            if (cb) cb();
            return;
        }

        loadSdk(function () {
            var UI = window.TON_CONNECT_UI && window.TON_CONNECT_UI.TonConnectUI;
            if (!UI) {
                console.warn('TonConnectUI not loaded');
                return;
            }

            _ui = new UI({
                manifestUrl: _manifestUrl,
                // No buttonRootId — we manage our own button UI
            });

            _ui.onStatusChange(function (wallet) {
                if (wallet) {
                    var addr = wallet.account && wallet.account.address;
                    saveAddress(addr);
                    if (addr) {
                        fetchBalance(addr, function (bal) {
                            notifyListeners({ connected: true, address: addr, balance: bal });
                        });
                    } else {
                        notifyListeners({ connected: true, address: null, balance: null });
                    }
                } else {
                    saveAddress('');
                    notifyListeners({ connected: false, address: null, balance: null });
                }
            });

            if (cb) cb();
        });
    }

    // ---------- public API ----------

    var WalletConnect = {
        /** Call once per page after the DOM is ready. */
        init: function (manifestUrl, options) {
            options = options || {};
            _manifestUrl = manifestUrl;
            _sdkUrl = options.sdkUrl || _sdkUrl;

            if (!options.lazy) {
                ensureUi();
            }

            // Restore previously stored address while waiting for the SDK to reconnect
            loadAddress(function (addr) {
                if (addr) {
                    fetchBalance(addr, function (bal) {
                        notifyListeners({ connected: true, address: addr, balance: bal, restoring: true });
                    });
                }
            });
        },

        /** Open the TonConnect modal. */
        connect: function () {
            ensureUi(function () {
                if (_ui) _ui.openModal();
            });
        },

        /** Disconnect the current wallet. */
        disconnect: function () {
            ensureUi(function () {
                if (_ui) _ui.disconnect();
            });
        },

        /** Register a callback: fn({ connected, address, balance, restoring? }) */
        onChange: function (fn) {
            _listeners.push(fn);
        },

        shortenAddress: shortenAddress,
        setPayoutAddress: setPayoutAddress,
        getPayoutAddress: getStoredPayoutAddress,
        removePayoutAddress: removePayoutAddress,
        isPayoutReplaceRateLimited: isPayoutReplaceRateLimited,
        looksLikeExchangeAddress: looksLikeExchangeAddress,
    };

    window.WalletConnect = WalletConnect;
})();
