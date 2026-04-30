import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

function distPath(file) {
  return resolve(__dirname, '..', 'dist', file);
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
        colorScheme: 'dark',
        MainButton: {
          setText() {}, show() {}, hide() {}, onClick() {}, offClick() {},
        },
        BackButton: {
          show() {}, hide() {}, onClick() {}, offClick() {},
        },
      },
    };
  });
}

test.describe('PWA Manifest', () => {
  test('manifest declares required fields', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'dist', '__manifest.json'), 'utf-8'));

    expect(manifest.name).toBe('TON Bridge — Bridge, Exchange, OTC');
    expect(manifest.short_name).toBe('TON Bridge');
    expect(manifest.id).toBe('/?utm_source=pwa');
    expect(manifest.description).toBeTruthy();
    expect(manifest.description.length).toBeLessThanOrEqual(150);
    expect(manifest.start_url).toBe('/?utm_source=pwa');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('en');
    expect(manifest.dir).toBe('ltr');
    expect(manifest.categories).toContain('finance');
    expect(manifest.categories).toContain('utilities');
  });

  test('manifest has full icon set 72→512 with maskable and monochrome', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'dist', '__manifest.json'), 'utf-8'));
    const sizes = manifest.icons.map(i => i.sizes);
    const purposes = manifest.icons.map(i => i.purpose);

    for (const size of ['72x72', '96x96', '128x128', '144x144', '152x152', '192x192', '384x384', '512x512']) {
      expect(sizes).toContain(size);
    }
    expect(purposes).toContain('maskable');
    expect(purposes).toContain('monochrome');
  });

  test('manifest has three shortcuts (Bridge, Exchange, OTC)', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'dist', '__manifest.json'), 'utf-8'));
    expect(manifest.shortcuts).toHaveLength(3);
    const names = manifest.shortcuts.map(s => s.name);
    expect(names).toContain('Bridge');
    expect(names).toContain('Exchange');
    expect(names).toContain('OTC');
  });

  test('manifest has six screenshots (3 mobile + 3 desktop)', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '..', 'dist', '__manifest.json'), 'utf-8'));
    expect(manifest.screenshots.length).toBeGreaterThanOrEqual(6);
    const narrow = manifest.screenshots.filter(s => s.form_factor === 'narrow');
    const wide = manifest.screenshots.filter(s => s.form_factor === 'wide');
    expect(narrow.length).toBeGreaterThanOrEqual(3);
    expect(wide.length).toBeGreaterThanOrEqual(3);
  });
});

test.describe('PWA Screenshots — mobile (1080×1920)', () => {
  test.use({ viewport: { width: 1080, height: 1920 } });

  test('Bridge tab screenshot', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await page.screenshot({
      path: resolve(__dirname, '..', 'assets/img/screenshots/bridge-mobile.png'),
      fullPage: false,
    });
  });

  test('Exchange tab screenshot', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));
    await page.screenshot({
      path: resolve(__dirname, '..', 'assets/img/screenshots/exchange-mobile.png'),
      fullPage: false,
    });
  });

  test('OTC tab screenshot', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));
    await page.screenshot({
      path: resolve(__dirname, '..', 'assets/img/screenshots/otc-mobile.png'),
      fullPage: false,
    });
  });
});

test.describe('PWA Screenshots — desktop (1280×800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Bridge tab desktop screenshot', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await page.screenshot({
      path: resolve(__dirname, '..', 'assets/img/screenshots/bridge-desktop.png'),
      fullPage: false,
    });
  });

  test('Exchange tab desktop screenshot', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));
    await page.screenshot({
      path: resolve(__dirname, '..', 'assets/img/screenshots/exchange-desktop.png'),
      fullPage: false,
    });
  });

  test('OTC tab desktop screenshot', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));
    await page.screenshot({
      path: resolve(__dirname, '..', 'assets/img/screenshots/otc-desktop.png'),
      fullPage: false,
    });
  });
});
