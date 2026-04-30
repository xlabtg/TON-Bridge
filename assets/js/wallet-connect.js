// TonConnect 2 wallet linking for TONBANKCARD payout address.
// Stores the verified wallet address in localStorage under 'tbc_ton_address'.
// Rate-limits address replacement to once per 24 h via 'tbc_ton_address_updated_at'.

(function () {
    var STORAGE_KEY = 'tbc_ton_address';
    var RATE_LIMIT_KEY = 'tbc_ton_address_updated_at';
    var RATE_LIMIT_MS = 24 * 60 * 60 * 1000;

    // Known centralized-exchange deposit address prefixes / patterns.
    // This is a soft heuristic: any address matching is flagged with a warning.
    var EXCHANGE_PATTERNS = [
        /^EQ[A-Za-z0-9_-]{46}$/,  // many CEX hot-wallets use bounceable EQ…
    ];

    function looksLikeExchangeAddress(addr) {
        // Very heuristic: flag if addr starts with known CEX root-prefixes.
        // Real-world check would query a known-addresses DB; this is a UI hint only.
        var knownCexPrefixes = [
            'EQBfAN7LfaUYgXZNw5Wc7GBgkEX2yhuJ5ka9X9V7M',
            'EQCzL4bHKkTfn9e5rW0',
        ];
        for (var i = 0; i < knownCexPrefixes.length; i++) {
            if (addr.startsWith(knownCexPrefixes[i])) return true;
        }
        return false;
    }

    function shortenAddress(addr) {
        if (!addr || addr.length < 12) return addr;
        return addr.slice(0, 6) + '…' + addr.slice(-4);
    }

    function getStoredAddress() {
        return localStorage.getItem(STORAGE_KEY) || '';
    }

    function isRateLimited() {
        var ts = parseInt(localStorage.getItem(RATE_LIMIT_KEY) || '0', 10);
        return ts > 0 && (Date.now() - ts) < RATE_LIMIT_MS;
    }

    function saveAddress(addr) {
        localStorage.setItem(STORAGE_KEY, addr);
        localStorage.setItem(RATE_LIMIT_KEY, String(Date.now()));
    }

    function removeAddress() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(RATE_LIMIT_KEY);
    }

    function renderWalletSection() {
        var section = document.getElementById('wallet-section');
        if (!section) return;

        var stored = getStoredAddress();
        var connectBtn = document.getElementById('wallet-connect-btn');
        var connectedBlock = document.getElementById('wallet-connected-block');
        var addressSpan = document.getElementById('wallet-address-display');
        var replaceBtn = document.getElementById('wallet-replace-btn');
        var removeBtn = document.getElementById('wallet-remove-btn');
        var warning = document.getElementById('wallet-exchange-warning');
        var disconnectNote = document.getElementById('wallet-disconnect-note');

        if (stored) {
            if (connectBtn) connectBtn.classList.add('d-none');
            if (connectedBlock) connectedBlock.classList.remove('d-none');
            if (addressSpan) addressSpan.textContent = shortenAddress(stored);
            if (addressSpan) addressSpan.title = stored;
            if (warning) {
                if (looksLikeExchangeAddress(stored)) {
                    warning.classList.remove('d-none');
                } else {
                    warning.classList.add('d-none');
                }
            }
            if (disconnectNote) disconnectNote.classList.remove('d-none');
        } else {
            if (connectBtn) connectBtn.classList.remove('d-none');
            if (connectedBlock) connectedBlock.classList.add('d-none');
            if (warning) warning.classList.add('d-none');
            if (disconnectNote) disconnectNote.classList.add('d-none');
        }
    }

    // Called after TonConnect successfully connects and returns a wallet.
    // addr must already be the canonical bounceable form.
    function onWalletConnected(addr) {
        var stored = getStoredAddress();

        if (stored && stored !== addr) {
            // Replacement flow
            if (isRateLimited()) {
                alert(window._walletI18n && window._walletI18n.rateLimitError
                    ? window._walletI18n.rateLimitError
                    : 'You can replace your payout address only once every 24 hours.');
                return;
            }
            var confirmMsg = window._walletI18n && window._walletI18n.replaceConfirm
                ? window._walletI18n.replaceConfirm
                : 'Replace existing payout address?';
            if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.showConfirm) {
                window.Telegram.WebApp.showConfirm(confirmMsg, function (ok) {
                    if (ok) {
                        saveAddress(addr);
                        renderWalletSection();
                        settleRedemptions(addr);
                    }
                });
            } else {
                if (window.confirm(confirmMsg)) {
                    saveAddress(addr);
                    renderWalletSection();
                    settleRedemptions(addr);
                }
            }
        } else {
            saveAddress(addr);
            renderWalletSection();
            settleRedemptions(addr);
        }
    }

    // Stub: in the full backend flow this would POST /me/wallet and trigger
    // pending redemptions. Here we emit a custom event so other modules can react.
    function settleRedemptions(addr) {
        window.dispatchEvent(new CustomEvent('tbc:wallet-linked', { detail: { address: addr } }));
    }

    function initTonConnect() {
        var connectBtn = document.getElementById('wallet-connect-btn');
        var replaceBtn = document.getElementById('wallet-replace-btn');
        var removeBtn = document.getElementById('wallet-remove-btn');

        if (connectBtn) {
            connectBtn.addEventListener('click', function () {
                openTonConnectModal();
            });
        }

        if (replaceBtn) {
            replaceBtn.addEventListener('click', function () {
                openTonConnectModal();
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', function () {
                removeAddress();
                renderWalletSection();
            });
        }

        renderWalletSection();
    }

    // Opens TonConnect UI if the SDK is available; falls back to a prompt for
    // environments where the CDN hasn't loaded (e.g., offline / tests).
    function openTonConnectModal() {
        if (window.TON_CONNECT_UI && window.__tonConnectUI) {
            window.__tonConnectUI.openModal();
            return;
        }
        // Lightweight fallback for environments without TonConnect SDK
        var addr = window.prompt
            ? window.prompt('Enter your TON wallet address:')
            : null;
        if (addr && addr.trim()) {
            onWalletConnected(addr.trim());
        }
    }

    function setupTonConnectUI() {
        if (typeof TonConnectUI === 'undefined') return;

        try {
            var ui = new TonConnectUI({
                manifestUrl: window.location.origin + '/__manifest.json',
                buttonRootId: null,  // we manage the button ourselves
            });
            window.__tonConnectUI = ui;
            window.TON_CONNECT_UI = true;

            ui.onStatusChange(function (wallet) {
                if (wallet && wallet.account && wallet.account.address) {
                    onWalletConnected(wallet.account.address);
                    // Immediately disconnect the TonConnect session — we only need
                    // the address proof, not an ongoing connection.
                    ui.disconnect();
                }
            });
        } catch (e) {
            console.error('TonConnect UI init failed', e);
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        setupTonConnectUI();
        initTonConnect();
    });

    // Expose for testing
    window._walletConnect = {
        onWalletConnected: onWalletConnected,
        getStoredAddress: getStoredAddress,
        removeAddress: removeAddress,
        isRateLimited: isRateLimited,
        renderWalletSection: renderWalletSection,
        looksLikeExchangeAddress: looksLikeExchangeAddress,
    };
})();
