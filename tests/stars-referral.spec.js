import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mock Telegram.WebApp with Stars-referral-relevant APIs.
 */
async function mockTelegramWebApp(page, opts = {}) {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */',
    }));

    await page.addInitScript((o) => {
        const haptic = { impactOccurred() {}, notificationOccurred() {} };
        const backButton = {
            _visible: false,
            _handlers: [],
            show() { this._visible = true; },
            hide() { this._visible = false; },
            onClick(fn) { this._handlers.push(fn); },
            offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
        };
        window.__tgBackButton = backButton;
        window.__tgOpenInvoiceCalls = [];
        window.__tgShareUrlCalls = [];
        window.Telegram = {
            WebApp: {
                ready() {},
                expand() {},
                onEvent() {},
                setHeaderColor() {},
                colorScheme: 'light',
                initData: o.initData || '',
                initDataUnsafe: o.initDataUnsafe || {},
                HapticFeedback: haptic,
                BackButton: backButton,
                openInvoice(url, cb) {
                    window.__tgOpenInvoiceCalls.push({ url, cb });
                },
                shareUrl(url) {
                    window.__tgShareUrlCalls.push(url);
                },
            },
        };
    }, opts);
}

function distUrl(file) {
    return 'file://' + resolve(__dirname, '..', 'dist', file);
}

/**
 * Helper: intercept the backend fetch so tests don't call the real Worker.
 */
async function mockBackend(page, response) {
    await page.route('https://bridge-worker.tonbankcard.workers.dev/api/referral*', route => {
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(response),
        });
    });
}

// ---------------------------------------------------------------------------

test.describe('Stars Referral Page — EN', () => {
    test('page title is correct', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral.html'));
        await expect(page).toHaveTitle(/Referral/i);
    });

    test('referral heading is visible', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral.html'));
        await expect(page.locator('h2').first()).toContainText('Stars Referral Program');
    });

    test('referral link input is rendered', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral.html'));
        await expect(page.locator('#referral-link-input')).toBeVisible();
    });

    test('referral link contains deep-link format when user id present', async ({ page }) => {
        await mockTelegramWebApp(page, {
            initData: '',
            initDataUnsafe: { user: { id: 123456789 } },
        });
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral.html'));

        // Give StarsReferral.init() time to run
        await page.waitForFunction(() => {
            const el = document.getElementById('referral-link-input');
            return el && el.value && el.value !== 'Loading…' && el.value !== '—';
        });

        const value = await page.locator('#referral-link-input').inputValue();
        expect(value).toMatch(/t\.me\/TONBridge_robot\/app\?startapp=ref_/);
    });

    test('copy button is present', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral.html'));
        await expect(page.locator('#copy-referral-btn')).toBeVisible();
    });

    test('share button is present', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral.html'));
        await expect(page.locator('#share-referral-btn')).toBeVisible();
    });
});

test.describe('Stars Referral Page — RU', () => {
    test('referral heading is in Russian', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral-ru.html'));
        await expect(page.locator('h2').first()).toContainText('Stars');
    });

    test('html lang attribute is ru', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral-ru.html'));
        const lang = await page.locator('html').getAttribute('lang');
        expect(lang).toBe('ru');
    });
});

test.describe('Stars Referral — pending Stars UI', () => {
    test('shows no-pending message when pending_stars is 0', async ({ page }) => {
        await mockTelegramWebApp(page, {
            initData: 'user=%7B%22id%22%3A1%7D&hash=abc',
            initDataUnsafe: { user: { id: 1 } },
        });
        await mockBackend(page, { ref_code: 'X', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral.html'));

        await page.waitForFunction(() => {
            const el = document.getElementById('claim-no-pending');
            return el && el.style.display !== 'none';
        });
        await expect(page.locator('#claim-no-pending')).toBeVisible();
    });

    test('shows claim button when pending_stars > 0', async ({ page }) => {
        await mockTelegramWebApp(page, {
            initData: 'user=%7B%22id%22%3A1%7D&hash=abc',
            initDataUnsafe: { user: { id: 1 } },
        });
        await mockBackend(page, { ref_code: 'X', pending_stars: 42, stars_disabled: false });
        await page.goto(distUrl('referral.html'));

        await page.waitForFunction(() => {
            const el = document.getElementById('claim-available');
            return el && el.style.display !== 'none';
        });
        await expect(page.locator('#claim-stars-btn')).toBeVisible();
        await expect(page.locator('#pending-stars-count')).toHaveText('42');
    });

    test('shows stars-disabled message when stars_disabled is true', async ({ page }) => {
        await mockTelegramWebApp(page, {
            initData: 'user=%7B%22id%22%3A1%7D&hash=abc',
            initDataUnsafe: { user: { id: 1 } },
        });
        await mockBackend(page, { ref_code: 'X', pending_stars: 0, stars_disabled: true });
        await page.goto(distUrl('referral.html'));

        await page.waitForFunction(() => {
            const el = document.getElementById('claim-stars-disabled');
            return el && el.style.display !== 'none';
        });
        await expect(page.locator('#claim-stars-disabled')).toBeVisible();
    });

    test('shows error when backend is unavailable', async ({ page }) => {
        await mockTelegramWebApp(page);
        // Simulate backend failure
        await page.route('https://bridge-worker.tonbankcard.workers.dev/api/referral*', route => {
            route.fulfill({ status: 500, body: 'Internal Error' });
        });
        await page.goto(distUrl('referral.html'));

        await page.waitForFunction(() => {
            const el = document.getElementById('claim-error');
            return el && el.style.display !== 'none';
        });
        await expect(page.locator('#claim-error')).toBeVisible();
    });
});

test.describe('Stars Referral — navigation', () => {
    test('bottom menu referral item is active on referral page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'X', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral.html'));
        const activeItem = page.locator('.appBottomMenu .item.active');
        await expect(activeItem).toContainText('Referral');
    });

    test('bottom menu on Bridge page includes referral link', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        const referralLink = page.locator('.appBottomMenu a[href="referral.html"]');
        await expect(referralLink).toBeVisible();
    });

    test('bottom menu on OTC page includes referral link', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index3.html'));
        const referralLink = page.locator('.appBottomMenu a[href="referral.html"]');
        await expect(referralLink).toBeVisible();
    });

    test('bottom menu on Settings page includes referral link', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('app-settings.html'));
        const referralLink = page.locator('.appBottomMenu a[href="referral.html"]');
        await expect(referralLink).toBeVisible();
    });
});

test.describe('Stars Referral — screenshots', () => {
    test('Screenshot: Referral EN — page renders correctly', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 77, stars_disabled: false });
        await page.goto(distUrl('referral.html'));
        await page.waitForFunction(() => {
            const el = document.getElementById('claim-available');
            return el && el.style.display !== 'none';
        });
        await page.screenshot({ path: 'tests/screenshots/referral-en.png', fullPage: false });
    });

    test('Screenshot: Referral RU — page renders correctly', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_stars: 0, stars_disabled: false });
        await page.goto(distUrl('referral-ru.html'));
        await page.waitForFunction(() => {
            const el = document.getElementById('claim-no-pending');
            return el && el.style.display !== 'none';
        });
        await page.screenshot({ path: 'tests/screenshots/referral-ru.png', fullPage: false });
    });
});
