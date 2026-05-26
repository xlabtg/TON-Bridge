// TonConnect 2 wallet integration using the self-hosted @tonconnect/ui build.
// Exposes window.WalletConnect for use in page templates.

(function () {
    var STORAGE_KEY = 'tc_ton_address';
    var PAYOUT_STORAGE_KEY = 'tbc_ton_address';
    var PAYOUT_RATE_LIMIT_KEY = 'tbc_ton_address_updated_at';
    var DAY_MS = 864e5;
    var TONCENTER_BASE = 'https://toncenter.com/api/v2/getAddressInformation?address=';
    var DEFAULT_WORKER_BASE = 'https://ton-bridge-worker.tonbankcard.workers.dev';

    var _ui = null;              // TonConnectUI instance
    var _manifestUrl = null;
    var _sdkUrl = null;
    var _sdkLoading = null;
    var _listeners = [];         // callbacks registered by page code
    var _lastState = null;
    var _statusSeq = 0;

    // ---------- helpers ----------

    function shortenAddress(addr) {
        if (!addr || addr.length < 12) return addr;
        return addr.slice(0, 6) + '…' + addr.slice(-4);
    }

    function nanoToTon(nano) {
        return (parseInt(nano, 10) / 1e9).toFixed(2);
    }

    function telegramWebApp() {
        try {
            return window.Telegram && window.Telegram.WebApp;
        } catch (_) {
            return null;
        }
    }

    function cloudStorage() {
        var tg = telegramWebApp();
        return tg && tg.CloudStorage ? tg.CloudStorage : null;
    }

    function setCloudValue(key, value) {
        var storage = cloudStorage();
        if (!storage || !storage.setItem) return;

        try {
            storage.setItem(key, value || '', function () {});
        } catch (_) {}
    }

    function removeCloudValue(key) {
        var storage = cloudStorage();
        if (!storage) return;

        try {
            if (storage.removeItem) {
                storage.removeItem(key, function () {});
            } else {
                storage.setItem(key, '', function () {});
            }
        } catch (_) {}
    }

    function saveAddress(addr) {
        try {
            var storage = cloudStorage();
            if (storage) {
                storage.setItem(STORAGE_KEY, addr || '', function () {});
            } else {
                localStorage.setItem(STORAGE_KEY, addr || '');
            }
        } catch (_) {}
    }

    function getStoredPayoutAddress() {
        try {
            return localStorage.getItem(PAYOUT_STORAGE_KEY) || '';
        } catch (_) {
            return '';
        }
    }

    function savePayoutAddress(addr) {
        var ts = String(Date.now());
        try {
            localStorage.setItem(PAYOUT_STORAGE_KEY, addr || '');
            localStorage.setItem(PAYOUT_RATE_LIMIT_KEY, ts);
        } catch (_) {}
        setCloudValue(PAYOUT_STORAGE_KEY, addr || '');
        setCloudValue(PAYOUT_RATE_LIMIT_KEY, ts);
    }

    function removePayoutAddress() {
        try {
            localStorage.removeItem(PAYOUT_STORAGE_KEY);
            localStorage.removeItem(PAYOUT_RATE_LIMIT_KEY);
        } catch (_) {}
        removeCloudValue(PAYOUT_STORAGE_KEY);
        removeCloudValue(PAYOUT_RATE_LIMIT_KEY);
        syncPayoutAddress('');
    }

    function isPayoutReplaceRateLimited() {
        var raw = '0';
        try {
            raw = localStorage.getItem(PAYOUT_RATE_LIMIT_KEY) || '0';
        } catch (_) {}
        var ts = parseInt(raw, 10);
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
            var storage = cloudStorage();
            if (storage) {
                storage.getItem(STORAGE_KEY, function (err, val) {
                    cb(err ? null : val);
                });
            } else {
                cb(localStorage.getItem(STORAGE_KEY));
            }
        } catch (_) {
            cb(null);
        }
    }

    function loadPayoutAddress() {
        var storage = cloudStorage();
        if (!storage || !storage.getItem) return;

        try {
            storage.getItem(PAYOUT_STORAGE_KEY, function (addrErr, cloudAddr) {
                var localAddr = getStoredPayoutAddress();
                cloudAddr = addrErr ? '' : (cloudAddr || '');

                if (cloudAddr) {
                    try { localStorage.setItem(PAYOUT_STORAGE_KEY, cloudAddr); } catch (_) {}
                } else if (localAddr) {
                    setCloudValue(PAYOUT_STORAGE_KEY, localAddr);
                }

                storage.getItem(PAYOUT_RATE_LIMIT_KEY, function (tsErr, cloudTs) {
                    var localTs = '';
                    try { localTs = localStorage.getItem(PAYOUT_RATE_LIMIT_KEY) || ''; } catch (_) {}
                    cloudTs = tsErr ? '' : (cloudTs || '');

                    if (cloudTs) {
                        try { localStorage.setItem(PAYOUT_RATE_LIMIT_KEY, cloudTs); } catch (_) {}
                    } else if (localTs) {
                        setCloudValue(PAYOUT_RATE_LIMIT_KEY, localTs);
                    }

                    var currentAddress = getStoredPayoutAddress();
                    if (currentAddress) syncPayoutAddress(currentAddress);
                    notifyPayoutLoaded(currentAddress);
                });
            });
        } catch (_) {}
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
        _lastState = state;
        for (var i = 0; i < _listeners.length; i++) {
            try { _listeners[i](state); } catch (_) {}
        }
    }

    function handleWalletStatus(wallet) {
        var seq = ++_statusSeq;

        if (wallet) {
            var addr = wallet.account && wallet.account.address;
            saveAddress(addr);
            if (addr) {
                fetchBalance(addr, function (bal) {
                    if (seq !== _statusSeq) return;
                    notifyListeners({ connected: true, address: addr, balance: bal });
                });
            } else {
                notifyListeners({ connected: true, address: null, balance: null });
            }
        } else {
            saveAddress('');
            notifyListeners({ connected: false, address: null, balance: null });
        }
    }

    function publicConfig() {
        return window.__TON_BRIDGE_CONFIG__ || {};
    }

    function workerBaseUrl() {
        return String(publicConfig().workerBaseUrl || DEFAULT_WORKER_BASE).replace(/\/+$/, '');
    }

    function resolveManifestUrl(manifestUrl) {
        var configured = publicConfig().tonConnectManifestUrl;
        var raw = configured || manifestUrl || '';
        raw = String(raw).trim();
        if (!raw) return raw;

        try {
            return new URL(raw, window.location.href).toString();
        } catch (_) {
            return raw;
        }
    }

    function notifyPayoutLinked(addr) {
        window.dispatchEvent(new CustomEvent('tbc:wallet-linked', { detail: { address: addr } }));
    }

    function notifyPayoutLoaded(addr) {
        window.dispatchEvent(new CustomEvent('tbc:payout-wallet-loaded', { detail: { address: addr } }));
    }

    function syncPayoutAddress(addr) {
        var tg = telegramWebApp();
        var initData = tg && tg.initData ? tg.initData : '';
        var base = workerBaseUrl();
        if (!initData || !base || !window.fetch) return;

        fetch(base + '/api/wallet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                initData: initData,
                ton_address: addr || ''
            })
        }).then(function (resp) {
            if (!resp.ok) {
                console.warn('Failed to sync payout wallet', resp.status);
            }
        }).catch(function (err) {
            console.warn('Failed to sync payout wallet', err);
        });
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
                    syncPayoutAddress(addr);
                    notifyPayoutLinked(addr);
                }
            });
            return true;
        }

        savePayoutAddress(addr);
        syncPayoutAddress(addr);
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
                restoreConnection: true,
                // No buttonRootId — we manage our own button UI
            });

            _ui.onStatusChange(handleWalletStatus);

            if (cb) cb();
        });
    }

    // ---------- public API ----------

    var WalletConnect = {
        /** Call once per page after the DOM is ready. */
        init: function (manifestUrl, options) {
            options = options || {};
            _manifestUrl = resolveManifestUrl(manifestUrl);
            _sdkUrl = options.sdkUrl || _sdkUrl;

            if (!options.lazy || options.restoreOnLoad !== false) {
                ensureUi();
            }

            // Restore previously stored address while waiting for the SDK to reconnect.
            // If TonConnect reports a fresh status first, do not let this fallback
            // overwrite it.
            var initialStatusSeq = _statusSeq;
            loadAddress(function (addr) {
                if (_statusSeq !== initialStatusSeq) return;
                if (addr) {
                    fetchBalance(addr, function (bal) {
                        if (_statusSeq !== initialStatusSeq) return;
                        notifyListeners({ connected: true, address: addr, balance: bal, restoring: true });
                    });
                }
            });
            loadPayoutAddress();
        },

        /** Open the TonConnect modal. */
        connect: function () {
            ensureUi(function () {
                if (!_ui) return;
                var modal = _ui.openModal();
                if (modal && modal.catch) {
                    modal.catch(function (err) {
                        console.warn('TonConnectUI modal failed to open', err);
                    });
                }
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
            if (_lastState) {
                setTimeout(function () {
                    try { fn(_lastState); } catch (_) {}
                }, 0);
            }
        },

        shortenAddress: shortenAddress,
        setPayoutAddress: setPayoutAddress,
        getPayoutAddress: getStoredPayoutAddress,
        removePayoutAddress: removePayoutAddress,
        syncPayoutAddress: syncPayoutAddress,
        isPayoutReplaceRateLimited: isPayoutReplaceRateLimited,
        looksLikeExchangeAddress: looksLikeExchangeAddress,
    };

    window.WalletConnect = WalletConnect;
})();
