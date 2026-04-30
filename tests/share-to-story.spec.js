import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function mockTelegramWebApp(page, { hasShareToStory = true } = {}) {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */',
    }));

    await page.addInitScript((opts) => {
        const calls = { shareToStory: [], openTelegramLink: [] };
        window.__tgCalls = calls;

        window.Telegram = {
            WebApp: {
                ready() {},
                expand() {},
                onEvent() {},
                setHeaderColor() {},
                colorScheme: 'light',
                MainButton: {
                    _text: '',
                    _visible: false,
                    _handlers: [],
                    setText(t) { this._text = t; },
                    show() { this._visible = true; },
                    hide() { this._visible = false; },
                    onClick(fn) { this._handlers.push(fn); },
                    offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
                },
                openTelegramLink(url) { calls.openTelegramLink.push(url); },
                ...(opts.hasShareToStory ? {
                    shareToStory(mediaUrl, opts2) { calls.shareToStory.push({ mediaUrl, opts: opts2 }); }
                } : {}),
            },
        };
    }, { hasShareToStory });
}

function distUrl(file) {
    return 'file://' + resolve(__dirname, '..', 'dist', file);
}

function fireSuccessMessage(page, extra = {}) {
    return page.evaluate((extra) => {
        window.dispatchEvent(new MessageEvent('message', {
            data: Object.assign({ type: 'change-now-widget-step', step: 'success' }, extra),
        }));
    }, extra);
}

test.describe('shareToStory — dialog appearance', () => {
    test('share dialog appears on success step (Bridge EN)', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        await fireSuccessMessage(page);
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
    });

    test('share dialog appears on success step (Bridge RU)', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index-ru.html'));
        await fireSuccessMessage(page);
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
    });

    test('share dialog appears on success step (Exchange EN)', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index2.html'));
        await fireSuccessMessage(page);
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
    });

    test('share dialog appears on success step (OTC EN)', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index3.html'));
        await fireSuccessMessage(page);
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
    });

    test('share dialog appears on finish step', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        await page.evaluate(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'change-now-widget-step', step: 'finish' },
            }));
        });
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
    });

    test('share dialog does NOT appear on non-terminal steps', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        await page.evaluate(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'change-now-widget-step', step: 'exchange' },
            }));
        });
        const dialog = page.locator('#share-story-dialog');
        await expect(dialog).toBeHidden({ timeout: 1000 });
    });

    test('EN dialog contains "Share my bridge" button', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        await fireSuccessMessage(page);
        await expect(page.locator('#share-story-dialog')).toContainText('Share my bridge');
    });

    test('RU dialog contains "Поделиться историей" button', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index-ru.html'));
        await fireSuccessMessage(page);
        await expect(page.locator('#share-story-dialog')).toContainText('Поделиться историей');
    });

    test('skip button dismisses the dialog', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        await fireSuccessMessage(page);
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
        await page.locator('#share-story-dialog').getByText('Skip').click();
        await expect(page.locator('#share-story-dialog')).toBeHidden({ timeout: 1000 });
    });

    test('dialog is not duplicated on multiple success events', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        await fireSuccessMessage(page);
        await fireSuccessMessage(page);
        const dialogs = page.locator('#share-story-dialog');
        await expect(dialogs).toHaveCount(1);
    });
});

test.describe('shareToStory — native share call', () => {
    test('calls tg.shareToStory when available', async ({ page }) => {
        await mockTelegramWebApp(page, { hasShareToStory: true });
        await page.goto(distUrl('index.html'));
        await fireSuccessMessage(page, { amount: '0.5', currency: 'TON', seconds: 38 });
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
        await page.locator('#share-story-dialog').getByText('Share my bridge').click();
        const calls = await page.evaluate(() => window.__tgCalls.shareToStory);
        expect(calls).toHaveLength(1);
        expect(calls[0].mediaUrl).toMatch(/^data:image\/png;base64,/);
        expect(calls[0].opts.text).toContain('0.5 TON');
        expect(calls[0].opts.text).toContain('@TONBridge_robot');
        expect(calls[0].opts.widget_link.url).toContain('t.me/TONBridge_robot');
        expect(calls[0].opts.widget_link.name).toBe('Try it →');
    });

    test('falls back to openTelegramLink when shareToStory unavailable', async ({ page }) => {
        await mockTelegramWebApp(page, { hasShareToStory: false });
        await page.goto(distUrl('index.html'));
        await fireSuccessMessage(page, { amount: '1', currency: 'BTC' });
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
        await page.locator('#share-story-dialog').getByText('Share my bridge').click();
        const calls = await page.evaluate(() => window.__tgCalls.openTelegramLink);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('t.me/share/url');
        expect(calls[0]).toContain('TONBridge_robot');
    });

    test('sticker URL includes referral code from localStorage', async ({ page }) => {
        await mockTelegramWebApp(page, { hasShareToStory: true });
        await page.goto(distUrl('index.html'));
        await page.evaluate(() => {
            localStorage.setItem('tonbridge_ref', 'TEST123');
        });
        await fireSuccessMessage(page);
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
        await page.locator('#share-story-dialog').getByText('Share my bridge').click();
        const calls = await page.evaluate(() => window.__tgCalls.shareToStory);
        expect(calls[0].opts.widget_link.url).toContain('ref_TEST123');
    });

    test('sticker URL works without referral code', async ({ page }) => {
        await mockTelegramWebApp(page, { hasShareToStory: true });
        await page.goto(distUrl('index.html'));
        await page.evaluate(() => {
            localStorage.removeItem('tonbridge_ref');
        });
        await fireSuccessMessage(page);
        await expect(page.locator('#share-story-dialog')).toBeVisible({ timeout: 3000 });
        await page.locator('#share-story-dialog').getByText('Share my bridge').click();
        const calls = await page.evaluate(() => window.__tgCalls.shareToStory);
        expect(calls[0].opts.widget_link.url).toBe('https://t.me/TONBridge_robot/app');
    });
});

test.describe('shareToStory — caption i18n', () => {
    test('EN caption contains "Bridged"', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        const caption = await page.evaluate(() =>
            window.__shareToStory.buildCaption('1.5', 'TON', 42));
        expect(caption).toContain('Bridged 1.5 TON');
        expect(caption).toContain('42s');
        expect(caption).toContain('@TONBridge_robot');
    });

    test('RU caption contains "Обменял"', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index-ru.html'));
        const caption = await page.evaluate(() =>
            window.__shareToStory.buildCaption('2', 'ETH', 15));
        expect(caption).toContain('Обменял 2 ETH');
        expect(caption).toContain('@TONBridge_robot');
    });
});

test.describe('shareToStory — Canvas card', () => {
    test('buildStoryCard returns a PNG data-URL', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        const dataUrl = await page.evaluate(() =>
            window.__shareToStory.buildStoryCard('5', 'TON', 60));
        expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });
});
