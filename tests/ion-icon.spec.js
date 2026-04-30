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
        ready() {}, expand() {}, onEvent() {}, setHeaderColor() {},
        colorScheme: 'light',
        MainButton: { setText() {}, show() {}, hide() {}, onClick() {}, offClick() {} },
      },
    };
  });
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

test.describe('Self-hosted ion-icon sprite', () => {
  test('No unpkg.com ionicons script tags in built HTML', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const unpkgScripts = await page.evaluate(() =>
      Array.from(document.scripts)
        .map(s => s.src)
        .filter(src => src.includes('unpkg.com') && src.includes('ionicons'))
    );
    expect(unpkgScripts).toHaveLength(0);
  });

  test('ion-icon custom element renders an SVG child', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    // Wait for custom element upgrade
    await page.waitForFunction(() =>
      customElements.get('ion-icon') !== undefined
    );
    const hasSvg = await page.evaluate(() => {
      const icon = document.querySelector('ion-icon');
      return icon !== null && icon.querySelector('svg') !== null;
    });
    expect(hasSvg).toBe(true);
  });

  test('ion-icon SVG use href points to local sprite', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await page.waitForFunction(() => customElements.get('ion-icon') !== undefined);
    const href = await page.evaluate(() => {
      const use = document.querySelector('ion-icon svg use');
      return use ? use.getAttribute('href') : null;
    });
    expect(href).toMatch(/^assets\/img\/icons\.svg#/);
  });

  test('Settings page: ion-icons render from local sprite', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    await page.waitForFunction(() => customElements.get('ion-icon') !== undefined);
    const count = await page.evaluate(() =>
      document.querySelectorAll('ion-icon svg').length
    );
    expect(count).toBeGreaterThan(0);
  });
});
