import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
    return 'file://' + resolve(__dirname, '..', 'dist', file);
}

const TEST_ADDRESS = 'EQD1234567890ABCDEFABCDEF1234567890ABCDEF1234A';
const TEST_BALANCE_NANO = '5000000000'; // 5 TON

/**
 * Sets up mocks for all external dependencies.
 */
async function setupMocks(page, options = {}) {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: '/* mocked */',
    }));
    await page.route('**/assets/js/vendor/tonconnect-ui.min.js', route => route.fulfill({
        status: 200, contentType: 'application/javascript',
        body: `
            window.TON_CONNECT_UI = {
                TonConnectUI: function(opts) {
                    this._opts = opts;
                    window.__tcInstance = this;
                    window.__tcInstances = window.__tcInstances || [];
                    window.__tcInstances.push(this);
                }
            };
            window.TON_CONNECT_UI.TonConnectUI.prototype.onStatusChange = function(fn) {
                window.__tcStatusChange = fn;
                if (this._opts.restoreConnection !== false && window.__tcRestoredWallet) {
                    setTimeout(() => fn(window.__tcRestoredWallet), 0);
                }
            };
            window.TON_CONNECT_UI.TonConnectUI.prototype.openModal = function() {
                window.__tcOpenModalCalled = true;
            };
            window.TON_CONNECT_UI.TonConnectUI.prototype.disconnect = function() {
                window.__tcDisconnectCalled = true;
                if (window.__tcStatusChange) window.__tcStatusChange(null);
            };
        `,
    }));
    await page.route('https://unpkg.com/ionicons@5.5.2/**', route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: '/* ionicons mocked */',
    }));
    await page.route('https://tganalytics.xyz/**', route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: '/* analytics mocked */',
    }));
    await page.route('https://changenow.io/**', route => route.fulfill({
        status: 200, contentType: 'text/html', body: '<html><body></body></html>',
    }));
    await page.route('https://mc.yandex.ru/**', route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: '/* yandex mocked */',
    }));
    // Mock TON Center balance API
    await page.route('https://toncenter.com/**', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, result: { balance: TEST_BALANCE_NANO } }),
    }));

    await page.addInitScript(({ config }) => {
        if (config) {
            window.__TON_BRIDGE_CONFIG__ = config;
        }
        const mainButton = {
            _text: '', _visible: false, _handlers: [],
            setText(t) { this._text = t; },
            show() { this._visible = true; },
            hide() { this._visible = false; },
            onClick(fn) { this._handlers.push(fn); },
            offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
        };
        const backButton = {
            _visible: false, _handlers: [],
            show() { this._visible = true; },
            hide() { this._visible = false; },
            onClick(fn) { this._handlers.push(fn); },
            offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
        };
        window.Telegram = {
            WebApp: {
                ready() {}, expand() {}, onEvent() {}, setHeaderColor() {},
                colorScheme: 'light',
                MainButton: mainButton,
                BackButton: backButton,
                CloudStorage: {
                    _store: {},
                    setItem(k, v, cb) { this._store[k] = v; if (cb) cb(null); },
                    getItem(k, cb) { cb(null, this._store[k] || ''); },
                },
            },
        };

        window.__tcStatusChange = null;
    }, { config: options.config || null });
}

/** Simulate a wallet connecting and wait for the UI to update. */
async function simulateConnect(page, address) {
    await page.evaluate(() => { window.WalletConnect.connect(); });
    await page.waitForFunction(() => typeof window.__tcStatusChange === 'function');
    await page.evaluate((addr) => {
        window.__tcStatusChange({ account: { address: addr } });
    }, address);
    // Wait for the async fetchBalance → notifyListeners → DOM update to settle
    await page.waitForFunction(
        (connectText) => {
            var el = document.getElementById('wallet-btn-label') || document.getElementById('wallet-settings-btn-label');
            return el && el.textContent !== connectText;
        },
        'Connect wallet',
        { timeout: 5000 }
    );
}

/** Simulate a wallet connecting on settings page. */
async function simulateConnectSettings(page, address) {
    await page.evaluate(() => { window.WalletConnect.connect(); });
    await page.waitForFunction(() => typeof window.__tcStatusChange === 'function');
    await page.evaluate((addr) => {
        window.__tcStatusChange({ account: { address: addr } });
    }, address);
    await page.waitForFunction(
        () => {
            var el = document.getElementById('wallet-settings-btn-label');
            return el && el.textContent !== 'Connect wallet' && el.textContent !== 'Подключить кошелёк';
        },
        { timeout: 5000 }
    );
}

test.describe('Wallet Connect — widget pages', () => {
    test('Bridge EN: "Connect wallet" button is visible in header', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));
        const btn = page.locator('#wallet-btn');
        await expect(btn).toBeVisible();
        const label = await page.locator('#wallet-btn-label').textContent();
        expect(label).toBe('Connect wallet');
    });

    test('Bridge RU: "Подключить кошелёк" button is visible after language switch', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));
        await page.evaluate(() => window.i18n.setLang('ru'));
        const label = await page.locator('#wallet-btn-label').textContent();
        expect(label).toBe('Подключить кошелёк');
    });

    test('Bridge EN: prefill bar is hidden before wallet connect', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));
        const bar = page.locator('#wallet-prefill-bar');
        await expect(bar).toBeHidden();
    });

    test('Exchange EN: prefill bar does not exist', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index2.html'));
        const bar = page.locator('#wallet-prefill-bar');
        await expect(bar).toHaveCount(0);
    });

    test('Bridge EN: prefill bar shows and chips appear after wallet connected', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));

        await simulateConnect(page, TEST_ADDRESS);

        const bar = page.locator('#wallet-prefill-bar');
        await expect(bar).toBeVisible();

        const maxChip = page.locator('#wallet-prefill-max');
        await expect(maxChip).toBeVisible();
    });

    test('Bridge EN: half chip label shows balance / 2', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));

        await simulateConnect(page, TEST_ADDRESS);

        // Balance is 5 TON (5000000000 nano); half = 2.50
        const halfLabel = await page.locator('#wallet-prefill-half-label').textContent();
        expect(halfLabel).toContain('2.50');
    });

    test('Bridge EN: header button label updates to address after wallet connected', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));

        await simulateConnect(page, TEST_ADDRESS);

        const label = await page.locator('#wallet-btn-label').textContent();
        expect(label).not.toBe('Connect wallet');
        expect(label).toContain('EQD123');
    });

    test('Bridge EN: prefill bar hides after disconnect', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));

        await simulateConnect(page, TEST_ADDRESS);
        await expect(page.locator('#wallet-prefill-bar')).toBeVisible();

        // Disconnect
        await page.evaluate(() => {
            if (window.__tcStatusChange) window.__tcStatusChange(null);
        });
        await expect(page.locator('#wallet-prefill-bar')).toBeHidden();

        const label = await page.locator('#wallet-btn-label').textContent();
        expect(label).toBe('Connect wallet');
    });

    test('WalletConnect.connect() opens TonConnect modal', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));

        await page.evaluate(() => { window.WalletConnect.connect(); });
        await page.waitForFunction(() => window.__tcOpenModalCalled === true);
    });

    test('Bridge EN: restores TonConnect session on page load without a second click', async ({ page }) => {
        await setupMocks(page);
        await page.addInitScript((addr) => {
            window.__tcRestoredWallet = { account: { address: addr }, device: { appName: 'tonkeeper' } };
        }, TEST_ADDRESS);
        await page.goto(distUrl('index.html'));

        await expect.poll(() => page.evaluate(() => !!window.__tcInstance)).toBe(true);
        await expect.poll(() => page.locator('#wallet-btn-label').textContent()).toContain('EQD123');
        await expect(page.locator('#wallet-prefill-bar')).toBeVisible();
    });

    test('Bridge EN: does not create duplicate TonConnect instances after restore', async ({ page }) => {
        await setupMocks(page);
        await page.addInitScript((addr) => {
            window.__tcRestoredWallet = { account: { address: addr }, device: { appName: 'tonkeeper' } };
        }, TEST_ADDRESS);
        await page.goto(distUrl('index.html'));

        await expect.poll(() => page.evaluate(() => !!window.__tcInstance)).toBe(true);
        await page.evaluate(() => { window.WalletConnect.connect(); });

        const instanceCount = await page.evaluate(() => window.__tcInstances && window.__tcInstances.length);
        expect(instanceCount).toBe(1);
        await expect.poll(() => page.evaluate(() => window.__tcOpenModalCalled === true)).toBe(true);
    });

    test('WalletConnect.shortenAddress trims long addresses to 6+4 chars', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));

        const short = await page.evaluate((addr) =>
            window.WalletConnect.shortenAddress(addr),
            TEST_ADDRESS
        );
        // slice(0,6) = 'EQD123', slice(-4) = '234A'
        expect(short).toBe('EQD123…234A');
    });

    test('Settings EN: wallet section with Connect wallet button is present', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('app-settings.html'));
        const btn = page.locator('#wallet-settings-btn');
        await expect(btn).toBeVisible();
        const label = await page.locator('#wallet-settings-btn-label').textContent();
        expect(label).toBe('Connect wallet');
    });

    test('Settings EN: wallet status updates to address after wallet connected', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('app-settings.html'));

        await simulateConnectSettings(page, TEST_ADDRESS);

        const status = await page.locator('#wallet-settings-status').textContent();
        expect(status).toContain('EQD123');

        const btnLabel = await page.locator('#wallet-settings-btn-label').textContent();
        expect(btnLabel).toBe('Disconnect');
    });

    test('Settings EN: disconnect button calls WalletConnect.disconnect', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('app-settings.html'));

        await simulateConnectSettings(page, TEST_ADDRESS);

        await page.locator('#wallet-settings-btn').click();
        const disconnected = await page.evaluate(() => window.__tcDisconnectCalled);
        expect(disconnected).toBe(true);
    });

    test('Settings EN: connect button opens the real TonConnect modal flow', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('app-settings.html'));

        await page.locator('#wallet-settings-btn').click();

        await expect.poll(() => page.evaluate(() => window.__tcOpenModalCalled === true)).toBe(true);
        const sdkOpts = await page.evaluate(() => window.__tcInstance && window.__tcInstance._opts);
        expect(sdkOpts.manifestUrl).toMatch(/tonconnect-manifest\.json$/);
    });

    test('Settings EN: uses configured absolute TonConnect manifest URL', async ({ page }) => {
        await setupMocks(page, {
            config: {
                tonConnectManifestUrl: 'https://example.com/bridge/tonconnect-manifest.json',
            },
        });
        await page.goto(distUrl('app-settings.html'));

        await page.locator('#wallet-settings-btn').click();

        await expect.poll(() => page.evaluate(() => window.__tcOpenModalCalled === true)).toBe(true);
        const sdkOpts = await page.evaluate(() => window.__tcInstance && window.__tcInstance._opts);
        expect(sdkOpts).toMatchObject({
            manifestUrl: 'https://example.com/bridge/tonconnect-manifest.json',
            restoreConnection: true,
        });
    });

    test('Bridge and Settings EN: CSP allows TonConnect registry and wallet bridges', async () => {
        const { readFileSync } = await import('fs');

        for (const file of ['index.html', 'app-settings.html']) {
            const html = readFileSync(resolve(__dirname, '..', 'dist', file), 'utf8');
            const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1] || '';
            const connectSrc = csp.match(/connect-src\s+([^;]+)/i)?.[1] || '';

            expect(connectSrc).toContain('https:');
            expect(connectSrc).toContain("'self'");
        }
    });

    test('Settings EN: connected wallet can be saved as payout address', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('app-settings.html'));

        await simulateConnectSettings(page, TEST_ADDRESS);
        await page.locator('#wallet-payout-save-btn').click();

        expect(await page.evaluate(() => WalletConnect.getPayoutAddress())).toBe(TEST_ADDRESS);
        await expect(page.locator('#wallet-payout-connected-row')).not.toHaveClass(/d-none/);
        await expect(page.locator('#wallet-payout-address-display')).toHaveAttribute('title', TEST_ADDRESS);
    });

    test('Settings EN: payout address persists after wallet disconnect', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('app-settings.html'));

        await simulateConnectSettings(page, TEST_ADDRESS);
        await page.locator('#wallet-payout-save-btn').click();
        await page.evaluate(() => {
            if (window.__tcStatusChange) window.__tcStatusChange(null);
        });

        expect(await page.evaluate(() => WalletConnect.getPayoutAddress())).toBe(TEST_ADDRESS);
        await expect(page.locator('#wallet-payout-disconnect-note')).not.toHaveClass(/d-none/);
    });

    test('Settings EN: payout replacement is rate limited for 24 hours', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('app-settings.html'));

        const replacement = 'UQC2DP7aXAP5uOKQXOiMSMR0w2jJ9Q4exampleAddressXYZ';
        await page.evaluate((addr) => {
            WalletConnect.setPayoutAddress(addr);
            localStorage.setItem('tbc_ton_address_updated_at', String(Date.now()));
        }, TEST_ADDRESS);
        await page.evaluate((addr) => {
            WalletConnect.setPayoutAddress(addr, {
                rateLimitError: 'rate limited',
                replaceConfirm: 'replace?'
            });
        }, replacement);

        expect(await page.evaluate(() => WalletConnect.getPayoutAddress())).toBe(TEST_ADDRESS);
        expect(await page.evaluate(() => WalletConnect.isPayoutReplaceRateLimited())).toBe(true);
    });

    test('Settings EN: CEX payout warning is shown for known exchange prefix', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('app-settings.html'));

        const cexAddress = 'EQBfAN7LfaUYgXZNw5Wc7GBgkEX2yhuJ5ka9X9V7MSomeAddr';
        await page.evaluate((addr) => {
            WalletConnect.setPayoutAddress(addr);
            document.getElementById('wallet-payout-connected-row').classList.remove('d-none');
            document.getElementById('wallet-payout-exchange-warning').classList.toggle(
                'd-none',
                !WalletConnect.looksLikeExchangeAddress(addr)
            );
        }, cexAddress);

        await expect(page.locator('#wallet-payout-exchange-warning')).not.toHaveClass(/d-none/);
    });

    test('tonconnect-manifest.json contains required fields', async ({ page }) => {
        const manifestPath = resolve(__dirname, '..', 'dist', 'tonconnect-manifest.json');
        const { readFileSync } = await import('fs');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        expect(manifest).toHaveProperty('url');
        expect(manifest).toHaveProperty('name');
        expect(manifest).toHaveProperty('iconUrl');
    });

    test('Screenshot: Bridge tab with wallet button in header', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('index.html'));
        await expect(page.locator('#wallet-btn')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/wallet-bridge-en.png', fullPage: false });
    });

    test('Screenshot: Settings tab with wallet section', async ({ page }) => {
        await setupMocks(page);
        await page.goto(distUrl('app-settings.html'));
        await expect(page.locator('#wallet-settings-btn')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/wallet-settings-en.png', fullPage: false });
    });
});
