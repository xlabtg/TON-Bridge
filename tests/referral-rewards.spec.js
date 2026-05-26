import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRIMARY_RGB = 'rgb(0, 127, 167)';
const PURPLE_RGB = 'rgb(98, 54, 255)';

async function mockTelegramWebApp(page, opts = {}) {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */',
    }));
    await page.route('https://tganalytics.xyz/**', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* analytics mocked */',
    }));
    await page.route('https://mc.yandex.ru/**', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* metrika mocked */',
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
        let storedRefCode = o.refCode || 'TESTCODE';

        window.__tgBackButton = backButton;
        window.__tgShareUrlCalls = [];
        window.Telegram = {
            WebApp: {
                ready() {},
                expand() {},
                onEvent() {},
                setHeaderColor() {},
                colorScheme: 'light',
                themeParams: o.themeParams || {},
                initData: o.initData || 'user=%7B%22id%22%3A123456789%7D&hash=abc',
                initDataUnsafe: o.initDataUnsafe || { user: { id: 123456789 } },
                HapticFeedback: haptic,
                BackButton: backButton,
                CloudStorage: {
                    getItem(_key, cb) { cb(null, storedRefCode); },
                    setItem(_key, value, cb) { storedRefCode = value; if (cb) cb(null); },
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

async function mockReferralApi(page, response, status = 200) {
    await page.route('https://ton-bridge-worker.tonbankcard.workers.dev/api/referral*', route => {
        route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(response),
        });
    });
}

function referralResponse(overrides = {}) {
    const refCode = overrides.ref_code || 'ABC12345';
    return {
        ok: true,
        ref_code: refCode,
        ref_share_url: 'https://t.me/TONBridge_robot/app?startapp=ref_' + refCode,
        points_per_tbc: 10,
        pending_points: 0,
        pending_tbc: 0,
        referral_points: 0,
        referral_tbc: 0,
        ...overrides,
    };
}

async function openReferral(page, file = 'referral.html', response = referralResponse()) {
    await mockTelegramWebApp(page);
    await mockReferralApi(page, response);
    await page.goto(distUrl(file));
}

test.describe('TBC Referral Page — copy and link', () => {
    test('page title and heading use TBC rewards copy', async ({ page }) => {
        await openReferral(page);

        await expect(page).toHaveTitle(/Referral/i);
        await expect(page.locator('h2').first()).toContainText('TBC Referral Program');
        await expect(page.locator('body')).not.toContainText('Stars');
        await expect(page.locator('body')).not.toContainText('⭐');
        await expect(page.locator('ion-icon[name="star-outline"]')).toHaveCount(0);
    });

    test('referral link comes from the referral rewards endpoint', async ({ page }) => {
        await openReferral(page, 'referral.html', referralResponse({
            ref_code: 'ABC12345',
            ref_share_url: 'https://t.me/TONBridge_robot/app?startapp=ref_ABC12345',
        }));

        await expect.poll(() => page.locator('#referral-link-input').inputValue())
            .toBe('https://t.me/TONBridge_robot/app?startapp=ref_ABC12345');
    });

    test('copy and share buttons are rendered', async ({ page }) => {
        await openReferral(page);

        await expect(page.locator('#copy-referral-btn')).toBeVisible();
        await expect(page.locator('#share-referral-btn')).toBeVisible();
    });
});

test.describe('TBC Referral Page — rewards balance', () => {
    test('shows empty state when the TBC points balance is zero', async ({ page }) => {
        await openReferral(page, 'referral.html', referralResponse({ pending_points: 0, pending_tbc: 0 }));

        await expect(page.locator('#reward-empty')).toBeVisible();
        await expect(page.locator('#reward-available')).toBeHidden();
    });

    test('shows TBC token equivalent when points are available', async ({ page }) => {
        await openReferral(page, 'referral.html', referralResponse({ pending_points: 125, pending_tbc: 12 }));

        await expect(page.locator('#reward-available')).toBeVisible();
        await expect(page.locator('#reward-points-count')).toHaveText('125');
        await expect(page.locator('#reward-tbc-count')).toHaveText('12.5');
        await expect(page.locator('#redeem-tbc-btn')).toHaveAttribute('href', 'redeem.html');
    });

    test('shows error when the referral rewards endpoint is unavailable', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockReferralApi(page, { ok: false, error: 'unavailable' }, 500);
        await page.goto(distUrl('referral.html'));

        await expect(page.locator('#reward-error')).toBeVisible();
    });
});

test.describe('TBC Referral Page — RU', () => {
    test('uses Russian TBC copy and no Stars wording', async ({ page }) => {
        await openReferral(page, 'referral-ru.html', referralResponse({ pending_points: 100, pending_tbc: 10 }));

        await expect(page.locator('h2').first()).toContainText('Реферальная программа TBC');
        await expect(page.locator('body')).toContainText('TBC-вознаграждения');
        await expect(page.locator('body')).not.toContainText('Stars');
        await expect(page.locator('body')).not.toContainText('⭐');
    });
});

test.describe('TBC Referral Page — main-page style', () => {
    test('uses the shared primary color instead of purple', async ({ page }) => {
        await openReferral(page, 'referral.html', referralResponse({ pending_points: 125, pending_tbc: 12 }));

        await expect(page.locator('#reward-available')).toBeVisible();

        const colors = await page.evaluate(() => {
            const style = selector => getComputedStyle(document.querySelector(selector));
            return {
                headerBackground: style('.appHeader').backgroundColor,
                headerButton: style('.appHeader .headerButton').color,
                copyButton: style('#copy-referral-btn').backgroundColor,
                shareButton: style('#share-referral-btn').backgroundColor,
                redeemButton: style('#redeem-tbc-btn').backgroundColor,
            };
        });

        expect(colors.headerBackground).toBe('rgb(255, 255, 255)');
        expect(colors.headerButton).not.toBe(PURPLE_RGB);
        expect(colors.copyButton).toBe(PRIMARY_RGB);
        expect(colors.shareButton).toBe('rgb(132, 148, 168)');
        expect(colors.redeemButton).toBe(PRIMARY_RGB);
        expect(Object.values(colors)).not.toContain(PURPLE_RGB);
    });
});

test.describe('TBC Referral Page — navigation', () => {
    test('marks referral tab active with a people icon', async ({ page }) => {
        await openReferral(page);

        const active = page.locator('.appBottomMenu .item.active');
        await expect(active).toContainText('Referral');
        await expect(active.locator('ion-icon[name="people-circle-outline"]')).toHaveCount(1);
        await expect(active.locator('ion-icon[name="star-outline"]')).toHaveCount(0);
    });
});

test.describe('TBC Referral Page — screenshots', () => {
    test('captures EN referral page', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openReferral(page, 'referral.html', referralResponse({ pending_points: 1250, pending_tbc: 125 }));

        await expect(page.locator('#reward-available')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/referral-en.png', fullPage: true });
    });

    test('captures RU referral page', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openReferral(page, 'referral-ru.html', referralResponse({ pending_points: 0, pending_tbc: 0 }));

        await expect(page.locator('#reward-empty')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/referral-ru.png', fullPage: true });
    });
});
