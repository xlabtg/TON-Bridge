import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mock Telegram.WebApp with referral-reward-relevant APIs.
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

test.describe('TBC Referral Page — EN', () => {
    test('page title is correct', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral.html'));
        await expect(page).toHaveTitle(/Referral/i);
    });

    test('referral heading is visible', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral.html'));
        await expect(page.locator('h2').first()).toContainText('TBC Referral Program');
    });

    test('referral link input is rendered', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral.html'));
        await expect(page.locator('#referral-link-input')).toBeVisible();
    });

    test('referral link contains deep-link format when user id present', async ({ page }) => {
        await mockTelegramWebApp(page, {
            initData: '',
            initDataUnsafe: { user: { id: 123456789 } },
        });
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral.html'));

        // Give ReferralRewards.init() time to run.
        await page.waitForFunction(() => {
            const el = document.getElementById('referral-link-input');
            return el && el.value && el.value !== 'Loading…' && el.value !== '—';
        });

        const value = await page.locator('#referral-link-input').inputValue();
        expect(value).toBe('https://t.me/TONBridge_robot/app?startapp=ref_ABC123');
    });

    test('copy button is present', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral.html'));
        await expect(page.locator('#copy-referral-btn')).toBeVisible();
    });

    test('share button is present', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral.html'));
        await expect(page.locator('#share-referral-btn')).toBeVisible();
    });

    test('uses TBC copy and main-page colors instead of Stars or purple', async ({ page }) => {
        await mockTelegramWebApp(page, {
            initData: 'user=%7B%22id%22%3A1%7D&hash=abc',
            initDataUnsafe: { user: { id: 1 } },
        });
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 770, pending_tbc: 77 });
        await page.goto(distUrl('referral.html'));

        await page.waitForFunction(() => {
            const el = document.getElementById('claim-available');
            return el && el.style.display !== 'none';
        });

        await expect(page.locator('body')).not.toContainText('Stars');
        await expect(page.locator('#pending-tbc-count')).toHaveText('77');

        const colors = await page.evaluate(() => {
            const style = selector => getComputedStyle(document.querySelector(selector));
            return {
                headerBackground: style('.appHeader').backgroundColor,
                headerButton: style('.appHeader .headerButton').color,
                copyButton: style('#copy-referral-btn').backgroundColor,
                shareButton: style('#share-referral-btn').backgroundColor,
                claimButton: style('#claim-reward-btn').backgroundColor,
            };
        });

        expect(colors.headerBackground).toBe('rgb(255, 255, 255)');
        expect(colors.headerButton).toBe('rgb(4, 159, 246)');
        expect(colors.copyButton).toBe('rgb(4, 159, 246)');
        expect(colors.shareButton).toBe('rgb(132, 148, 168)');
        expect(colors.claimButton).toBe('rgb(4, 159, 246)');
        expect(Object.values(colors)).not.toContain('rgb(98, 54, 255)');
    });
});

test.describe('TBC Referral Page — RU', () => {
    test('referral heading is in Russian', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral-ru.html'));
        await expect(page.locator('h2').first()).toContainText('TBC');
        await expect(page.locator('body')).not.toContainText('Stars');
    });

    test('html lang attribute is ru', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral-ru.html'));
        const lang = await page.locator('html').getAttribute('lang');
        expect(lang).toBe('ru');
    });
});

test.describe('TBC Referral — pending rewards UI', () => {
    test('shows no-pending message when pending_tbc is 0', async ({ page }) => {
        await mockTelegramWebApp(page, {
            initData: 'user=%7B%22id%22%3A1%7D&hash=abc',
            initDataUnsafe: { user: { id: 1 } },
        });
        await mockBackend(page, { ref_code: 'X', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral.html'));

        await page.waitForFunction(() => {
            const el = document.getElementById('claim-no-pending');
            return el && el.style.display !== 'none';
        });
        await expect(page.locator('#claim-no-pending')).toBeVisible();
    });

    test('shows redeem button when pending_tbc > 0', async ({ page }) => {
        await mockTelegramWebApp(page, {
            initData: 'user=%7B%22id%22%3A1%7D&hash=abc',
            initDataUnsafe: { user: { id: 1 } },
        });
        await mockBackend(page, { ref_code: 'X', pending_points: 420, pending_tbc: 42 });
        await page.goto(distUrl('referral.html'));

        await page.waitForFunction(() => {
            const el = document.getElementById('claim-available');
            return el && el.style.display !== 'none';
        });
        await expect(page.locator('#claim-reward-btn')).toBeVisible();
        await expect(page.locator('#pending-tbc-count')).toHaveText('42');
    });

    test('shows rewards-disabled message when rewards_disabled is true', async ({ page }) => {
        await mockTelegramWebApp(page, {
            initData: 'user=%7B%22id%22%3A1%7D&hash=abc',
            initDataUnsafe: { user: { id: 1 } },
        });
        await mockBackend(page, { ref_code: 'X', pending_points: 0, pending_tbc: 0, rewards_disabled: true });
        await page.goto(distUrl('referral.html'));

        await page.waitForFunction(() => {
            const el = document.getElementById('claim-reward-disabled');
            return el && el.style.display !== 'none';
        });
        await expect(page.locator('#claim-reward-disabled')).toBeVisible();
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

test.describe('TBC Referral — navigation', () => {
    test('bottom menu referral item is active on referral page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'X', pending_points: 0, pending_tbc: 0 });
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

test.describe('TBC Referral — screenshots', () => {
    test('Screenshot: Referral EN — page renders correctly', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 770, pending_tbc: 77 });
        await page.goto(distUrl('referral.html'));
        await page.waitForFunction(() => {
            const el = document.getElementById('claim-available');
            return el && el.style.display !== 'none';
        });
        await page.screenshot({ path: 'tests/screenshots/referral-en.png', fullPage: false });
    });

    test('Screenshot: Referral RU — page renders correctly', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockBackend(page, { ref_code: 'ABC123', pending_points: 0, pending_tbc: 0 });
        await page.goto(distUrl('referral-ru.html'));
        await page.waitForFunction(() => {
            const el = document.getElementById('claim-no-pending');
            return el && el.style.display !== 'none';
        });
        await page.screenshot({ path: 'tests/screenshots/referral-ru.png', fullPage: false });
    });
});
