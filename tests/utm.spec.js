import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

async function mockTelegramWithStartParam(page, startParam) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript((sp) => {
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        MainButton: {
          setText() {}, show() {}, hide() {}, onClick() {}, offClick() {},
        },
        initDataUnsafe: sp ? { start_param: sp } : {},
      },
    };
  }, startParam);
}

test.describe('UTM attribution — start_param parsing', () => {
  test('structured start_param populates __tonbridgeUtm', async ({ page }) => {
    await mockTelegramWithStartParam(
      page,
      'utm_source__tonapp__utm_medium__directory__utm_campaign__v2_launch'
    );
    await page.goto(distUrl('index.html'));
    const utm = await page.evaluate(() => window.__tonbridgeUtm);
    expect(utm).not.toBeNull();
    expect(utm.utm_source).toBe('tonapp');
    expect(utm.utm_medium).toBe('directory');
    expect(utm.utm_campaign).toBe('v2_launch');
  });

  test('plain utm_source start_param sets utm_source', async ({ page }) => {
    await mockTelegramWithStartParam(page, 'utm_source__dappradar');
    await page.goto(distUrl('index.html'));
    const utm = await page.evaluate(() => window.__tonbridgeUtm);
    expect(utm).not.toBeNull();
    expect(utm.utm_source).toBe('dappradar');
  });

  test('no start_param results in null __tonbridgeUtm', async ({ page }) => {
    await mockTelegramWithStartParam(page, null);
    await page.goto(distUrl('index.html'));
    const utm = await page.evaluate(() => window.__tonbridgeUtm);
    expect(utm).toBeNull();
  });

  test('UTM persists in sessionStorage across pages', async ({ page }) => {
    await mockTelegramWithStartParam(
      page,
      'utm_source__tonapps__utm_medium__directory__utm_campaign__v2_launch'
    );
    await page.goto(distUrl('index.html'));
    const stored = await page.evaluate(() => sessionStorage.getItem('tgbridge_utm'));
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored);
    expect(parsed.utm_source).toBe('tonapps');
  });

  test('utm.js included in OTC page', async ({ page }) => {
    await mockTelegramWithStartParam(
      page,
      'utm_source__tonapp__utm_medium__directory__utm_campaign__v2_launch'
    );
    await page.goto(distUrl('index3.html'));
    const utm = await page.evaluate(() => window.__tonbridgeUtm);
    expect(utm).not.toBeNull();
    expect(utm.utm_source).toBe('tonapp');
  });
});
