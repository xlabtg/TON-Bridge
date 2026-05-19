import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
                BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
                MainButton: {
                    setText() {},
                    show() {},
                    hide() {},
                    onClick() {},
                    offClick() {},
                    setParams() {},
                    enable() {},
                    disable() {},
                },
                HapticFeedback: { notificationOccurred() {}, impactOccurred() {} },
                CloudStorage: {
                    setItem(_k, _v, cb) { if (cb) cb(null); },
                    getItem(_k, cb) { cb(null, null); },
                },
                initDataUnsafe: {},
            },
        };
    });
}

function distUrl(file) {
    return 'file://' + resolve(__dirname, '..', 'dist', file);
}

const EXPECTED_TABS = [
    { key: 'bridge',     i18n: 'nav_bridge',     href: 'index' },
    { key: 'exchange',   i18n: 'nav_exchange',   href: 'index2' },
    { key: 'otc',        i18n: 'nav_otc',        href: 'index3' },
    { key: 'orders',     i18n: 'nav_orders',     href: 'orders' },
    { key: 'redeem',     i18n: 'nav_redeem',     href: 'redeem' },
    { key: 'statistics', i18n: 'nav_statistics', href: 'index4' },
    { key: 'referral',   i18n: 'nav_referral',   href: 'referral' },
    { key: 'settings',   i18n: 'nav_settings',   href: 'app-settings' },
];

// One file per *-page.njk shell + locale variant, so a regression in any
// shell (5/6/8-tab divergence) fails this single suite.
const SHELLS = [
    ['Bridge EN',     'index.html',         'bridge'],
    ['Exchange EN',   'index2.html',        'exchange'],
    ['OTC EN',        'index3.html',        'otc'],
    ['Statistics EN', 'index4.html',        'statistics'],
    ['Statistics RU', 'index4-ru.html',     'statistics'],
    ['Orders EN',     'orders.html',        'orders'],
    ['Orders RU',     'orders-ru.html',     'orders'],
    ['Redeem EN',     'redeem.html',        'redeem'],
    ['Redeem RU',     'redeem-ru.html',     'redeem'],
    ['Referral EN',   'referral.html',      'referral'],
    ['Referral RU',   'referral-ru.html',   'referral'],
    ['Settings EN',   'app-settings.html',  'settings'],
];

test.describe('Bottom navigation – unified shape (issue #118)', () => {
    for (const [label, file, expectedActive] of SHELLS) {
        test(`${label}: renders the same 8-tab nav with "${expectedActive}" active`, async ({ page }) => {
            await mockTelegramWebApp(page);
            await page.goto(distUrl(file));

            const nav = page.locator('nav.appBottomMenu');
            await expect(nav).toHaveCount(1);

            const tabs = nav.locator('a.item');
            await expect(tabs).toHaveCount(EXPECTED_TABS.length);

            for (let i = 0; i < EXPECTED_TABS.length; i++) {
                const { i18n, href, key } = EXPECTED_TABS[i];
                const tab = tabs.nth(i);
                await expect(tab.locator('[data-i18n]')).toHaveAttribute('data-i18n', i18n);
                const realHref = await tab.getAttribute('href');
                expect(realHref).toContain(href);

                const isActive = key === expectedActive;
                await expect(tab).toHaveAttribute('aria-selected', isActive ? 'true' : 'false');
                if (isActive) {
                    await expect(tab).toHaveClass(/\bactive\b/);
                }
            }

            // Exactly one active tab on every shell — the core invariant.
            const active = nav.locator('a.item.active');
            await expect(active).toHaveCount(1);
            const activeSelected = nav.locator('a.item[aria-selected="true"]');
            await expect(activeSelected).toHaveCount(1);
        });
    }

    test('EN and RU shells of the same page render identical nav structure', async ({ page }) => {
        const pairs = [
            ['orders.html', 'orders-ru.html'],
            ['redeem.html', 'redeem-ru.html'],
            ['referral.html', 'referral-ru.html'],
            ['index4.html', 'index4-ru.html'],
        ];

        async function navShape(file) {
            await mockTelegramWebApp(page);
            await page.goto(distUrl(file));
            return page.locator('nav.appBottomMenu a.item').evaluateAll(items =>
                items.map(a => ({
                    i18n: a.querySelector('[data-i18n]')?.getAttribute('data-i18n') || null,
                    selected: a.getAttribute('aria-selected'),
                    activeClass: a.classList.contains('active'),
                }))
            );
        }

        for (const [en, ru] of pairs) {
            const enShape = await navShape(en);
            const ruShape = await navShape(ru);
            expect(ruShape).toEqual(enShape);
        }
    });
});
