import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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

test.describe('Social-proof widget markup', () => {
    test('Bridge pages no longer render the social-proof element after the intro copy', async ({ page }) => {
        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));

        await expect(page.locator('#social-proof-pill')).toHaveCount(0);
        await expect(page.locator('#social-proof-region')).toHaveCount(0);
    });

    test('social-proof script remains a no-op when markup is absent', async ({ page }) => {
        let statsRequests = 0;
        await page.route('https://api.changenow.io/v1/info/stats*', route => {
            statsRequests += 1;
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ count: 12343, volume: 500000 }),
            });
        });

        await mockTelegramWebApp(page);
        await page.goto(distUrl('index.html'));
        await page.waitForTimeout(100);

        expect(statsRequests).toBe(0);
        await expect(page.locator('#social-proof-pill')).toHaveCount(0);
    });
});
