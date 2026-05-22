import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
    return 'file://' + resolve(__dirname, '..', 'dist', file);
}

async function mockTelegramWebApp(page) {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* mocked */',
    }));

    await page.addInitScript(() => {
        const cloudStorage = {
            _store: {},
            getItem(key, cb) { cb(null, this._store[key] || null); },
            setItem(key, val, cb) { this._store[key] = val; if (cb) cb(null); },
        };
        window.__tgCloudStorage = cloudStorage;
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
                CloudStorage: cloudStorage,
                HapticFeedback: {
                    _last: null,
                    notificationOccurred(type) { this._last = type; },
                },
            },
        };
    });
}

// Page scripts now load with `defer`, so `window.Achievements` is set after
// the defer queue runs. `page.goto` resolves on the `load` event which *should*
// fire after all defer scripts, but file:// + page.route can race in rare cases.
// Wait explicitly for the global to be defined before tests touch it.
async function gotoPage(page, file) {
    await page.goto(distUrl(file));
    await page.waitForFunction(() => typeof window.Achievements !== 'undefined', null, { timeout: 5000 });
}

async function setLangPref(page, lang) {
    await page.addInitScript((l) => {
        localStorage.setItem('pref:lang', l);
    }, lang);
}

test.describe('Achievement / tier system', () => {

    test('tier badge element is present on Bridge page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        const badge = page.locator('#tier-badge');
        await expect(badge).toBeAttached();
    });

    test('tier progress bar element is not rendered on Bridge page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        const bar = page.locator('#tier-progress-bar');
        await expect(bar).toHaveCount(0);
    });

    test('Achievements.computeTier returns null for 0 swaps', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        const tier = await page.evaluate(() => window.Achievements.computeTier(0, 0));
        expect(tier).toBeNull();
    });

    test('Achievements.computeTier returns bronze for 1 swap', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        const tier = await page.evaluate(() => window.Achievements.computeTier(1, 0));
        expect(tier).not.toBeNull();
        expect(tier.id).toBe('bronze');
    });

    test('Achievements.computeTier returns silver for 10 swaps', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        const tier = await page.evaluate(() => window.Achievements.computeTier(10, 0));
        expect(tier.id).toBe('silver');
    });

    test('Achievements.computeTier returns gold for 100 swaps', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        const tier = await page.evaluate(() => window.Achievements.computeTier(100, 0));
        expect(tier.id).toBe('gold');
    });

    test('Achievements.computeTier returns gold for $10000 volume even with few swaps', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        const tier = await page.evaluate(() => window.Achievements.computeTier(1, 10000));
        expect(tier.id).toBe('gold');
    });

    test('Achievements.computeTier returns platinum for 1000 swaps', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        const tier = await page.evaluate(() => window.Achievements.computeTier(1000, 0));
        expect(tier.id).toBe('platinum');
    });

    test('Achievements.computeTier returns platinum for $100000 volume', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        const tier = await page.evaluate(() => window.Achievements.computeTier(1, 100000));
        expect(tier.id).toBe('platinum');
    });

    test('recordSwap persists stats and updates badge', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');

        await page.evaluate(() => window.Achievements.recordSwap(0));
        await page.waitForTimeout(100);

        const badgeText = await page.evaluate(() => document.getElementById('tier-badge').textContent);
        expect(badgeText).toContain('Bronze');
    });

    test('tier badge shows bronze flair class after first swap', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');

        await page.evaluate(() => window.Achievements.recordSwap(0));
        await page.waitForTimeout(100);

        const cls = await page.evaluate(() => document.getElementById('tier-badge').className);
        expect(cls).toContain('tier-bronze');
    });

    test('celebration modal appears on tier-up', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');

        // First swap should trigger Bronze tier-up
        await page.evaluate(() => window.Achievements.recordSwap(0));
        await page.waitForTimeout(100);

        const modalDisplay = await page.evaluate(() => {
            const modal = document.getElementById('tier-celebration-modal');
            return modal ? modal.style.display : 'missing';
        });
        expect(modalDisplay).toBe('flex');
    });

    test('celebration modal close button hides the modal', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');

        await page.evaluate(() => window.Achievements.recordSwap(0));
        await page.waitForTimeout(100);

        // Click close
        await page.evaluate(() => {
            const btn = document.querySelector('.tier-celebration-close');
            if (btn) btn.click();
        });

        const modalDisplay = await page.evaluate(() =>
            document.getElementById('tier-celebration-modal').style.display
        );
        expect(modalDisplay).toBe('none');
    });

    test('swap success postMessage triggers recordSwap', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');

        // Dispatch the widget success message
        await page.evaluate(() => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { type: 'change-now-widget-step', step: 'success' },
            }));
        });
        await page.waitForTimeout(200);

        // Stats should have swaps=1
        const stats = await page.evaluate(() => {
            return new Promise(resolve => {
                window.Achievements._loadStats(resolve);
            });
        });
        expect(stats.swaps).toBe(1);
    });

    test('recordSwap works without the tier progress markup', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');

        await page.evaluate(() => window.Achievements.recordSwap(0));
        await page.waitForTimeout(100);

        await expect(page.locator('#tier-progress-label')).toHaveCount(0);
        await expect(page.locator('#tier-progress-bar')).toHaveCount(0);
        await expect(page.locator('#tier-badge')).toContainText('Bronze');
    });

    test('tier badge remains present and progress bar is absent on Exchange page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index2.html');
        await expect(page.locator('#tier-badge')).toBeAttached();
        await expect(page.locator('#tier-progress-bar')).toHaveCount(0);
    });

    test('tier badge remains present and progress bar is absent on OTC page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index3.html');
        await expect(page.locator('#tier-badge')).toBeAttached();
        await expect(page.locator('#tier-progress-bar')).toHaveCount(0);
    });

    test('tier badge remains present and progress bar is absent on RU Bridge page', async ({ page }) => {
        await mockTelegramWebApp(page);
        await setLangPref(page, 'ru');
        await gotoPage(page, 'index.html');
        await page.waitForFunction(() => document.documentElement.lang === 'ru');
        await expect(page.locator('#tier-badge')).toBeAttached();
        await expect(page.locator('#tier-progress-bar')).toHaveCount(0);
    });

    test('celebration share button in RU page shows translated text', async ({ page }) => {
        await mockTelegramWebApp(page);
        await setLangPref(page, 'ru');
        await gotoPage(page, 'index.html');
        await page.waitForFunction(() => document.documentElement.lang === 'ru');
        const shareText = await page.evaluate(() => {
            const btn = document.querySelector('.tier-celebration-share');
            return btn ? btn.textContent.trim() : '';
        });
        expect(shareText).toBe('Поделиться');
    });

    test('Screenshot: Bridge page with tier badge', async ({ page }) => {
        await mockTelegramWebApp(page);
        await gotoPage(page, 'index.html');
        await page.evaluate(() => window.Achievements.recordSwap(0));
        await page.waitForTimeout(100);
        await page.screenshot({ path: 'tests/screenshots/bridge-tier-bronze.png', fullPage: false });
    });
});
