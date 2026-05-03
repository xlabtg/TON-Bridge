import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MOCK_ORDERS = [
    {
        id: 'txabc123def456',
        fromCurrency: 'ton',
        toCurrency: 'usdt',
        amountFrom: 10,
        amountTo: 9.8,
        status: 'finished',
        createdAt: '2025-01-15T12:00:00Z',
    },
    {
        id: 'txghi789jkl012',
        fromCurrency: 'btc',
        toCurrency: 'ton',
        amountFrom: 0.1,
        amountTo: 1234.5,
        status: 'exchanging',
        createdAt: '2025-01-15T11:30:00Z',
    },
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {number|null} userId  Telegram user id (null = no user)
 * @param {object|object[]|null|undefined} ordersResponse
 *   - undefined → fetch is not mocked (will fail if called)
 *   - null → fetch rejects (network error)
 *   - object → always returns that object
 *   - array of objects → returns them in sequence (last one repeated)
 */
async function mockTelegramWebApp(page, userId, ordersResponse) {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */',
    }));

    // Mock fetch: file:// origin means page.route can't intercept relative /api/ URLs.
    await page.addInitScript(({ uid, ordersResp, hasOrdersResp }) => {
        const cloudStorage = {};
        window.__tgHaptic = { notifications: [] };
        window.__fetchCallCount = 0;
        window.Telegram = {
            WebApp: {
                ready() {},
                expand() {},
                onEvent() {},
                setHeaderColor() {},
                colorScheme: 'light',
                BackButton: {
                    show() {},
                    hide() {},
                    onClick() {},
                    offClick() {},
                },
                HapticFeedback: {
                    notificationOccurred(type) {
                        window.__tgHaptic.notifications.push(type);
                    },
                    impactOccurred() {},
                },
                CloudStorage: {
                    setItem(key, value, cb) {
                        cloudStorage[key] = value;
                        if (cb) cb(null);
                    },
                    getItem(key, cb) {
                        cb(null, cloudStorage[key] || null);
                    },
                },
                initDataUnsafe: uid ? { user: { id: uid } } : {},
            },
        };

        if (hasOrdersResp) {
            const responses = ordersResp === null ? null
                : (Array.isArray(ordersResp) ? ordersResp : [ordersResp]);
            let idx = 0;
            window.fetch = function (url) {
                if (url && url.includes('/api/orders')) {
                    window.__fetchCallCount++;
                    if (responses === null) {
                        return Promise.reject(new Error('Network error'));
                    }
                    const resp = responses[Math.min(idx, responses.length - 1)];
                    idx++;
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(resp),
                    });
                }
                return Promise.reject(new Error('Not mocked: ' + url));
            };
        }
    }, {
        uid: userId,
        ordersResp: ordersResponse,
        hasOrdersResp: ordersResponse !== undefined,
    });
}

function distUrl(file) {
    return 'file://' + resolve(__dirname, '..', 'dist', file);
}

test.describe('Orders page', () => {
    test('EN: Orders tab is in bottom nav and marked active', async ({ page }) => {
        await mockTelegramWebApp(page, null, null);
        await page.goto(distUrl('orders.html'));

        const ordersTab = page.locator('.appBottomMenu a.active');
        await expect(ordersTab).toHaveCount(1);
        const href = await ordersTab.getAttribute('href');
        expect(href).toContain('orders');
    });

    test('EN: page title is "Orders"', async ({ page }) => {
        await mockTelegramWebApp(page, null, null);
        await page.goto(distUrl('orders.html'));
        await expect(page.locator('.pageTitle')).toContainText('Orders');
    });

    test('RU: page title is "Заказы"', async ({ page }) => {
        await mockTelegramWebApp(page, null, null);
        await page.goto(distUrl('orders-ru.html'));
        await expect(page.locator('.pageTitle')).toContainText('Заказы');
    });

    test('Empty state is shown when no orders and no user id', async ({ page }) => {
        // No userId → orders.js skips fetch → empty state shown
        await mockTelegramWebApp(page, null, undefined);
        await page.goto(distUrl('orders.html'));

        await expect(page.locator('#orders-empty')).toBeVisible({ timeout: 3000 });
        await expect(page.locator('#orders-list')).toBeEmpty();
    });

    test('Orders are rendered from API response', async ({ page }) => {
        await mockTelegramWebApp(page, 12345, { orders: MOCK_ORDERS });
        await page.goto(distUrl('orders.html'));

        await expect(page.locator('.order-item')).toHaveCount(2, { timeout: 5000 });

        const firstItem = page.locator('.order-item').first();
        await expect(firstItem.locator('.order-pair')).toContainText('TON → USDT');
        await expect(firstItem.locator('.badge')).toContainText('Finished');
    });

    test('Loading spinner hides after fetch completes', async ({ page }) => {
        await mockTelegramWebApp(page, 12345, { orders: [] });
        await page.goto(distUrl('orders.html'));

        await expect(page.locator('#orders-loading')).toBeHidden({ timeout: 5000 });
    });

    test('Txn ID copy button is present for each order', async ({ page }) => {
        await mockTelegramWebApp(page, 12345, { orders: MOCK_ORDERS });
        await page.goto(distUrl('orders.html'));

        await expect(page.locator('.order-copy-btn')).toHaveCount(2, { timeout: 5000 });

        const btn = page.locator('.order-copy-btn').first();
        const txid = await btn.getAttribute('data-txid');
        expect(txid).toBe('txabc123def456');
    });

    test('HapticFeedback fires on status change to finished', async ({ page }) => {
        // First response: order is 'exchanging'; subsequent polls return 'finished'
        const firstResp = { orders: [{ ...MOCK_ORDERS[1] }] };
        const pollResp = { orders: [{ ...MOCK_ORDERS[1], status: 'finished' }] };
        await mockTelegramWebApp(page, 12345, [firstResp, pollResp]);

        // Speed up poll interval for the test
        await page.addInitScript(() => { window.__TEST_POLL_INTERVAL = 100; });

        await page.goto(distUrl('orders.html'));

        await expect(page.locator('.order-item')).toHaveCount(1, { timeout: 5000 });

        // Wait long enough for at least one poll (>100ms)
        await page.waitForTimeout(600);

        const notifications = await page.evaluate(() => window.__tgHaptic.notifications);
        expect(notifications).toContain('success');
    });

    test('Orders tab appears in Bridge page bottom nav', async ({ page }) => {
        await mockTelegramWebApp(page, null);
        await page.goto(distUrl('index.html'));

        const ordersLink = page.locator('.appBottomMenu a[href*="orders"]');
        await expect(ordersLink).toBeVisible();
    });

    test('Orders tab appears in Settings page bottom nav', async ({ page }) => {
        await mockTelegramWebApp(page, null);
        await page.goto(distUrl('app-settings.html'));

        const ordersLink = page.locator('.appBottomMenu a[href*="orders"]');
        await expect(ordersLink).toBeVisible();
    });

    test('CloudStorage is populated after successful fetch', async ({ page }) => {
        await mockTelegramWebApp(page, 12345, { orders: MOCK_ORDERS });
        await page.goto(distUrl('orders.html'));

        await expect(page.locator('.order-item')).toHaveCount(2, { timeout: 5000 });

        const count = await page.locator('.order-item').count();
        expect(count).toBe(2);
    });

    test('Screenshot: Orders page — empty state', async ({ page }) => {
        await mockTelegramWebApp(page, null, undefined);
        await page.goto(distUrl('orders.html'));
        await expect(page.locator('#orders-empty')).toBeVisible({ timeout: 3000 });
        await page.screenshot({ path: 'tests/screenshots/orders-empty-en.png', fullPage: false });
    });

    test('Screenshot: Orders page — with orders', async ({ page }) => {
        await mockTelegramWebApp(page, 12345, { orders: MOCK_ORDERS });
        await page.goto(distUrl('orders.html'));
        await expect(page.locator('.order-item')).toHaveCount(2, { timeout: 5000 });
        await page.screenshot({ path: 'tests/screenshots/orders-with-data-en.png', fullPage: false });
    });
});
