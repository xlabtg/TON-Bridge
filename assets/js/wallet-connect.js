// TonConnect 2 wallet integration using @tonconnect/ui CDN build.
// Relies on window.TON_CONNECT_UI being set by the CDN script loaded before this file.
// Exposes window.WalletConnect for use in page templates.

(function () {
    var STORAGE_KEY = 'tc_ton_address';
    var TONCENTER_BASE = 'https://toncenter.com/api/v2/getAddressInformation?address=';

    var _ui = null;          // TonConnectUI instance
    var _listeners = [];     // callbacks registered by page code

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

    // ---------- public API ----------

    var WalletConnect = {
        /** Call once per page after the DOM is ready. */
        init: function (manifestUrl) {
            if (_ui) return;

            var UI = window.TON_CONNECT_UI && window.TON_CONNECT_UI.TonConnectUI;
            if (!UI) {
                console.warn('TonConnectUI not loaded');
                return;
            }

            _ui = new UI({
                manifestUrl: manifestUrl,
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
            if (!_ui) return;
            _ui.openModal();
        },

        /** Disconnect the current wallet. */
        disconnect: function () {
            if (!_ui) return;
            _ui.disconnect();
        },

        /** Register a callback: fn({ connected, address, balance, restoring? }) */
        onChange: function (fn) {
            _listeners.push(fn);
        },

        shortenAddress: shortenAddress,
    };

    window.WalletConnect = WalletConnect;
})();
