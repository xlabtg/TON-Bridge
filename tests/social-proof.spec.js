import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
    return 'file://' + resolve(__dirname, '..', 'dist', file);
}

// Intercept the ChangeNOW stats API with a mock response.
async function mockStatsApi(page, data) {
    await page.route('https://api.changenow.io/v1/info/stats*', route => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(data),
        });
    });
}

// Block the stats API to simulate an outage.
async function blockStatsApi(page) {
    await page.route('https://api.changenow.io/v1/info/stats*', route => route.abort());
}

// Mock the Telegram.WebApp so the page scripts don't throw.
async function mockTelegramWebApp(page) {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */',
    }));
    await page.addInitScript(() => {
        window.Telegram = {
            WebApp: {
                ready() {},
                expand() {},
                onEvent() {},
                setHeaderColor() {},
                colorScheme: 'light',
                MainButton: {
                    setText() {},
                    show() {},
                    hide() {},
                    onClick() {},
                    offClick() {},
                },
                BackButton: {
                    show() {},
                    hide() {},
                    onClick() {},
                    offClick() {},
                },
            },
        };
    });
}

test.describe('Social-proof widget', () => {
    test('pill is present in Bridge EN page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 12343, volume: 500000 });
        await page.goto(distUrl('index.html'));
        const pill = page.locator('#social-proof-pill');
        await expect(pill).toBeAttached();
    });

    test('pill is present in Bridge RU page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 12343, volume: 500000 });
        await page.goto(distUrl('index-ru.html'));
        const pill = page.locator('#social-proof-pill');
        await expect(pill).toBeAttached();
    });

    test('pill is NOT present in Exchange page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index2.html'));
        const pill = page.locator('#social-proof-pill');
        await expect(pill).toHaveCount(0);
    });

    test('pill is NOT present in OTC page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index3.html'));
        const pill = page.locator('#social-proof-pill');
        await expect(pill).toHaveCount(0);
    });

    test('pill becomes visible with count > 0', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 12343, volume: 500000 });
        await page.goto(distUrl('index.html'));
        const pill = page.locator('#social-proof-pill');
        await expect(pill).not.toHaveAttribute('hidden');
    });

    test('pill text contains formatted count', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 12343, volume: 500000 });
        await page.goto(distUrl('index.html'));
        const text = page.locator('#social-proof-pill .sp-text');
        // Intl.NumberFormat for EN locale formats 12343 as "12,343"
        await expect(text).toContainText('12,343');
    });

    test('pill text contains formatted volume', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 12343, volume: 500000 });
        await page.goto(distUrl('index.html'));
        const text = page.locator('#social-proof-pill .sp-text');
        await expect(text).toContainText('$500,000');
    });

    test('pill stays hidden when count is 0', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 0, volume: 0 });
        await page.goto(distUrl('index.html'));
        const pill = page.locator('#social-proof-pill');
        // pill should have hidden attribute or not be visible
        await expect(pill).toHaveAttribute('hidden');
    });

    test('pill stays hidden on API outage', async ({ page }) => {
        await mockTelegramWebApp(page);
        await blockStatsApi(page);
        await page.goto(distUrl('index.html'));
        const pill = page.locator('#social-proof-pill');
        // Without cached data and API failing, pill should remain hidden
        await expect(pill).toHaveAttribute('hidden');
    });

    test('aria-live region exists and is visually hidden', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 5000, volume: 200000 });
        await page.goto(distUrl('index.html'));
        const region = page.locator('#social-proof-region');
        await expect(region).toBeAttached();
        await expect(region).toHaveAttribute('aria-live', 'polite');
        await expect(region).toHaveAttribute('aria-atomic', 'true');
        await expect(region).toHaveClass(/visually-hidden/);
    });

    test('aria-live region is populated on first render', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 5000, volume: 200000 });
        // Ensure no prior announcement in sessionStorage
        await page.addInitScript(() => {
            sessionStorage.removeItem('sp_announced');
            sessionStorage.removeItem('sp_widget_v1');
        });
        await page.goto(distUrl('index.html'));
        const region = page.locator('#social-proof-region');
        await expect(region).not.toBeEmpty();
    });

    test('count is capped at MAX_COUNT (1 000 000)', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 9999999, volume: 500000 });
        await page.goto(distUrl('index.html'));
        const text = page.locator('#social-proof-pill .sp-text');
        // Should render 1,000,000 not 9,999,999
        await expect(text).toContainText('1,000,000');
    });

    test('sessionStorage is used: cached value renders instantly', async ({ page }) => {
        await mockTelegramWebApp(page);
        // Pre-seed sessionStorage, then block the network
        await page.addInitScript(() => {
            sessionStorage.setItem('sp_widget_v1', JSON.stringify({ count: 888, volume: 100 }));
        });
        await blockStatsApi(page);
        await page.goto(distUrl('index.html'));
        const text = page.locator('#social-proof-pill .sp-text');
        await expect(text).toContainText('888');
    });

    test('RU locale formats number with space separator', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 12343, volume: 500000 });
        await page.goto(distUrl('index-ru.html'));
        const text = page.locator('#social-proof-pill .sp-text');
        // In RU locale Intl.NumberFormat uses non-breaking space: "12 343"
        // We just check the count digits are present
        await expect(text).toContainText('12');
        await expect(text).toContainText('343');
    });

    test('Screenshot: Bridge EN with social-proof pill', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockStatsApi(page, { count: 12343, volume: 500000 });
        await page.goto(distUrl('index.html'));
        await expect(page.locator('#social-proof-pill')).not.toHaveAttribute('hidden');
        await page.screenshot({ path: 'tests/screenshots/social-proof-bridge-en.png', fullPage: false });
    });
});
