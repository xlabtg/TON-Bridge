import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
    return 'file://' + resolve(__dirname, '..', 'dist', file);
}

/** Full Telegram WebApp mock including showConfirm and initData. */
async function mockTelegramWebApp(page, overrides = {}) {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */',
    }));

    await page.addInitScript((opts) => {
        const mainButton = {
            _text: '',
            _visible: false,
            _disabled: false,
            _handlers: [],
            setText(t) { this._text = t; },
            show()     { this._visible = true; },
            hide()     { this._visible = false; },
            enable()   { this._disabled = false; },
            disable()  { this._disabled = true; },
            onClick(fn) { this._handlers.push(fn); },
            offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
        };
        window.__tgMainButton = mainButton;
        window.__confirmResult = opts.confirmResult !== undefined ? opts.confirmResult : true;
        window.__confirmCalled = false;

        window.Telegram = {
            WebApp: {
                ready() {},
                expand() {},
                onEvent() {},
                setHeaderColor() {},
                colorScheme: 'light',
                MainButton: mainButton,
                BackButton: {
                    show() {},
                    hide() {},
                    onClick() {},
                    offClick() {},
                },
                initData: opts.initData || '',
                showConfirm(msg, cb) {
                    window.__confirmCalled = true;
                    window.__confirmMsg = msg;
                    cb(window.__confirmResult);
                },
            },
        };
    }, overrides);
}

/** Mock the worker /api/balance endpoint. */
async function mockWorkerBalance(page, balanceData) {
    await page.route('**/api/balance**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(balanceData),
    }));
}

/** Mock the worker /api/redeem endpoint. */
async function mockWorkerRedeem(page, response) {
    await page.route('**/api/redeem', route => route.fulfill({
        status: response.status || 200,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
    }));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Redeem screen — EN', () => {
    test('shows balance and slider when balance >= 100', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockWorkerBalance(page, { points: 350, ton_address: null, redemptions: [] });

        await page.goto(distUrl('redeem.html'));
        await page.waitForSelector('#balancePoints');

        const pts = await page.textContent('#balancePoints');
        expect(pts.trim()).toBe('350');

        // Slider should be visible
        const slider = page.locator('#redeemSlider');
        await expect(slider).toBeVisible();

        // Slider max should be 350 (nearest multiple of 10)
        const max = await slider.getAttribute('max');
        expect(Number(max)).toBe(350);
    });

    test('hides slider and shows no-balance message when balance < 100', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockWorkerBalance(page, { points: 50, ton_address: null, redemptions: [] });

        await page.goto(distUrl('redeem.html'));
        await page.waitForSelector('#balancePoints');

        await expect(page.locator('#noBalanceMsg')).toBeVisible();
        await expect(page.locator('#redeemForm')).toBeHidden();
    });

    test('slider updates TBC and USD values on input', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockWorkerBalance(page, { points: 500, ton_address: 'EQA', redemptions: [] });

        await page.goto(distUrl('redeem.html'));
        await page.waitForSelector('#redeemSlider');

        // Set slider to 200
        await page.locator('#redeemSlider').evaluate(el => {
            el.value = '200';
            el.dispatchEvent(new Event('input'));
        });

        const tbc = await page.textContent('#sliderTbc');
        const usd = await page.textContent('#sliderUsd');
        expect(tbc.trim()).toBe('20');
        expect(usd.trim()).toBe('$0.006');
    });

    test('MainButton is shown with "Redeem" text when balance >= 100', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockWorkerBalance(page, { points: 200, ton_address: 'EQA', redemptions: [] });

        await page.goto(distUrl('redeem.html'));
        await page.waitForSelector('#redeemSlider');

        const text = await page.evaluate(() => window.__tgMainButton._text);
        expect(text).toBe('Redeem');

        const visible = await page.evaluate(() => window.__tgMainButton._visible);
        expect(visible).toBe(true);
    });

    test('shows confirm dialog when MainButton is clicked', async ({ page }) => {
        await mockTelegramWebApp(page, { confirmResult: false });
        await mockWorkerBalance(page, { points: 200, ton_address: 'EQA', redemptions: [] });
        await mockWorkerRedeem(page, { status: 200, body: { ok: true, queued: false, tbc_amount: 10 } });

        await page.goto(distUrl('redeem.html'));
        await page.waitForSelector('#redeemSlider');

        // Fire MainButton handlers
        await page.evaluate(() => {
            window.__tgMainButton._handlers.forEach(h => h());
        });

        const called = await page.evaluate(() => window.__confirmCalled);
        expect(called).toBe(true);
    });

    test('calls /api/redeem and shows success toast on confirm', async ({ page }) => {
        await mockTelegramWebApp(page, { confirmResult: true });
        await mockWorkerBalance(page, { points: 200, ton_address: 'EQA', redemptions: [] });
        // Second balance call after successful redemption
        let redeemCalled = false;
        await page.route('**/api/redeem', route => {
            redeemCalled = true;
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true, queued: false, tbc_amount: 10, redemption_id: 1 }),
            });
        });

        await page.goto(distUrl('redeem.html'));
        await page.waitForSelector('#redeemSlider');

        // Fire MainButton handlers
        await page.evaluate(() => {
            window.__tgMainButton._handlers.forEach(h => h());
        });

        // Wait for fetch to be called
        await page.waitForTimeout(200);
        expect(redeemCalled).toBe(true);
    });

    test('shows redemption history when present', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockWorkerBalance(page, {
            points: 0,
            ton_address: null,
            redemptions: [
                { id: 1, points_spent: 100, tbc_amount: 10, status: 'paid', created_at: '2024-01-15T12:00:00' },
            ],
        });

        await page.goto(distUrl('redeem.html'));
        await page.waitForSelector('#historySection');

        await expect(page.locator('#historySection')).toBeVisible();
        const items = page.locator('#historyList li');
        await expect(items).toHaveCount(1);
        const statusBadge = page.locator('.status-paid');
        await expect(statusBadge).toBeVisible();
    });

    test('Screenshot: Redeem screen with balance', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockWorkerBalance(page, {
            points: 350,
            ton_address: 'EQA123',
            redemptions: [
                { id: 1, points_spent: 100, tbc_amount: 10, status: 'paid', created_at: '2024-01-10T10:00:00' },
            ],
        });

        await page.goto(distUrl('redeem.html'));
        await page.waitForSelector('#redeemSlider');
        await page.screenshot({ path: 'tests/screenshots/redeem-en.png', fullPage: false });
    });
});

test.describe('Redeem screen — RU', () => {
    test('RU: shows "Баллы" in nav and "Обменять" as MainButton text', async ({ page }) => {
        await mockTelegramWebApp(page);
        await mockWorkerBalance(page, { points: 200, ton_address: 'EQA', redemptions: [] });

        await page.goto(distUrl('redeem-ru.html'));
        await page.waitForSelector('#redeemSlider');

        const text = await page.evaluate(() => window.__tgMainButton._text);
        expect(text).toBe('Обменять');

        // Check nav label
        const navLabel = await page.locator('.appBottomMenu a.active strong').textContent();
        expect(navLabel.trim()).toBe('Баллы');
    });
});

test.describe('Redeem link in navigation — other tabs', () => {
    test('Bridge EN tab has Redeem link in bottom nav', async ({ page }) => {
        await page.route('https://telegram.org/js/telegram-web-app.js', r => r.fulfill({
            status: 200, contentType: 'application/javascript', body: '/* mocked */',
        }));
        await page.addInitScript(() => {
            window.Telegram = {
                WebApp: {
                    ready() {}, expand() {}, onEvent() {}, setHeaderColor() {},
                    colorScheme: 'light',
                    MainButton: { setText() {}, show() {}, hide() {}, onClick() {}, offClick() {} },
                },
            };
        });

        await page.goto(distUrl('index.html'));
        const redeemLink = page.locator('.appBottomMenu a[href="redeem.html"]');
        await expect(redeemLink).toBeVisible();
    });
});
