import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
    return 'file://' + resolve(__dirname, '..', 'dist', file);
}

/**
 * Block external CDN scripts so pages load fully offline.
 * Inject minimal Telegram and TonConnect mocks before page scripts run.
 */
async function setupPage(page) {
    // Block external scripts
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */',
    }));
    await page.route('https://unpkg.com/**', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */',
    }));

    await page.addInitScript(() => {
        // Minimal Telegram.WebApp mock
        window.Telegram = {
            WebApp: {
                ready() {},
                expand() {},
                onEvent() {},
                setHeaderColor() {},
                colorScheme: 'light',
                BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
                showConfirm(msg, cb) { cb(true); },
            },
        };

        // Clear localStorage so tests start clean
        localStorage.clear();
    });
}

test.describe('Wallet linking — settings page EN', () => {
    test('Connect button is visible when no wallet stored', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const btn = page.locator('#wallet-connect-btn');
        await expect(btn).toBeVisible();
    });

    test('Connected block is hidden when no wallet stored', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const block = page.locator('#wallet-connected-block');
        await expect(block).toHaveClass(/d-none/);
    });

    test('After onWalletConnected, address is stored and rendered', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const addr = 'UQBvI0aFLnw2QbZgjMPCLRdtRHxhUyinQudg19NyBUx9WLMn';
        await page.evaluate((a) => {
            window._walletConnect.onWalletConnected(a);
        }, addr);

        const stored = await page.evaluate(() => window._walletConnect.getStoredAddress());
        expect(stored).toBe(addr);

        const connectBtn = page.locator('#wallet-connect-btn');
        await expect(connectBtn).toHaveClass(/d-none/);

        const connectedBlock = page.locator('#wallet-connected-block');
        await expect(connectedBlock).not.toHaveClass(/d-none/);

        const display = page.locator('#wallet-address-display');
        const text = await display.textContent();
        expect(text).toContain('UQBvI0');
    });

    test('Address is shortened in the display', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const addr = 'UQBvI0aFLnw2QbZgjMPCLRdtRHxhUyinQudg19NyBUx9WLMn';
        await page.evaluate((a) => {
            window._walletConnect.onWalletConnected(a);
        }, addr);

        const display = page.locator('#wallet-address-display');
        const text = await display.textContent();
        // Shortened should NOT be the full address
        expect(text.length).toBeLessThan(addr.length);
        // But title attribute contains the full address
        const title = await display.getAttribute('title');
        expect(title).toBe(addr);
    });

    test('Remove button clears stored address', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const addr = 'UQBvI0aFLnw2QbZgjMPCLRdtRHxhUyinQudg19NyBUx9WLMn';
        await page.evaluate((a) => {
            window._walletConnect.onWalletConnected(a);
        }, addr);

        await page.evaluate(() => {
            window._walletConnect.removeAddress();
            window._walletConnect.renderWalletSection();
        });

        const stored = await page.evaluate(() => window._walletConnect.getStoredAddress());
        expect(stored).toBe('');

        const connectBtn = page.locator('#wallet-connect-btn');
        await expect(connectBtn).not.toHaveClass(/d-none/);
    });

    test('Exchange address warning shown for known CEX pattern', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const cexAddr = 'EQBfAN7LfaUYgXZNw5Wc7GBgkEX2yhuJ5ka9X9V7MSomeAddr';
        await page.evaluate((a) => {
            window._walletConnect.onWalletConnected(a);
        }, cexAddr);

        const warning = page.locator('#wallet-exchange-warning');
        await expect(warning).not.toHaveClass(/d-none/);
    });

    test('Exchange address warning hidden for non-CEX address', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const safeAddr = 'UQBvI0aFLnw2QbZgjMPCLRdtRHxhUyinQudg19NyBUx9WLMn';
        await page.evaluate((a) => {
            window._walletConnect.onWalletConnected(a);
        }, safeAddr);

        const warning = page.locator('#wallet-exchange-warning');
        await expect(warning).toHaveClass(/d-none/);
    });

    test('Rate limit blocks replacement within 24 h', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const addr1 = 'UQBvI0aFLnw2QbZgjMPCLRdtRHxhUyinQudg19NyBUx9WLMn';
        const addr2 = 'UQC2DP7aXAP5uOKQXOiMSMR0w2jJ9Q4exampleAddressXYZ';

        // First connect — not rate limited
        await page.evaluate((a) => {
            window._walletConnect.onWalletConnected(a);
        }, addr1);

        // Simulate rate limit already in place (set updated_at to now)
        await page.evaluate(() => {
            localStorage.setItem('tbc_ton_address_updated_at', String(Date.now()));
        });

        // Collect alerts shown during the second connect attempt
        const alerts = [];
        page.on('dialog', async (dialog) => {
            alerts.push(dialog.message());
            await dialog.dismiss();
        });

        await page.evaluate((a) => {
            window._walletConnect.onWalletConnected(a);
        }, addr2);

        // Address should NOT have changed
        const stored = await page.evaluate(() => window._walletConnect.getStoredAddress());
        expect(stored).toBe(addr1);
    });

    test('isRateLimited returns false when no timestamp set', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const limited = await page.evaluate(() => window._walletConnect.isRateLimited());
        expect(limited).toBe(false);
    });

    test('isRateLimited returns true when timestamp is recent', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        await page.evaluate(() => {
            localStorage.setItem('tbc_ton_address_updated_at', String(Date.now()));
        });

        const limited = await page.evaluate(() => window._walletConnect.isRateLimited());
        expect(limited).toBe(true);
    });

    test('Wallet section heading text is "Payout Wallet"', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const headings = page.locator('.listview-title');
        const texts = await headings.allTextContents();
        expect(texts.some(t => t.includes('Payout Wallet'))).toBe(true);
    });

    test('disconnect-note hidden when no wallet stored', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const note = page.locator('#wallet-disconnect-note');
        await expect(note).toHaveClass(/d-none/);
    });

    test('disconnect-note visible when wallet is stored', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        const addr = 'UQBvI0aFLnw2QbZgjMPCLRdtRHxhUyinQudg19NyBUx9WLMn';
        await page.evaluate((a) => {
            window._walletConnect.onWalletConnected(a);
        }, addr);

        const note = page.locator('#wallet-disconnect-note');
        await expect(note).not.toHaveClass(/d-none/);
    });

    test('tbc:wallet-linked event fired when address is saved', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings.html'));

        // Listen for the custom event
        await page.evaluate(() => {
            window.__walletLinkedEvents = [];
            window.addEventListener('tbc:wallet-linked', function (e) {
                window.__walletLinkedEvents.push(e.detail);
            });
        });

        const addr = 'UQBvI0aFLnw2QbZgjMPCLRdtRHxhUyinQudg19NyBUx9WLMn';
        await page.evaluate((a) => {
            window._walletConnect.onWalletConnected(a);
        }, addr);

        const events = await page.evaluate(() => window.__walletLinkedEvents);
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].address).toBe(addr);
    });
});

test.describe('Wallet linking — settings page RU', () => {
    test('Wallet section heading text is in Russian', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings-ru.html'));

        const headings = page.locator('.listview-title');
        const texts = await headings.allTextContents();
        expect(texts.some(t => t.includes('Кошелёк для выплат'))).toBe(true);
    });

    test('Connect button is visible when no wallet stored (RU)', async ({ page }) => {
        await setupPage(page);
        await page.goto(distUrl('app-settings-ru.html'));

        const btn = page.locator('#wallet-connect-btn');
        await expect(btn).toBeVisible();
    });
});
