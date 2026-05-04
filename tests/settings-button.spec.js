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
    const settingsButton = {
      _visible: false,
      _handlers: [],
      show() { this._visible = true; },
      hide() { this._visible = false; },
      onClick(fn) { this._handlers.push(fn); },
      offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
    };
    const mainButton = {
      _text: '',
      _visible: false,
      _handlers: [],
      setText(text) { this._text = text; },
      show() { this._visible = true; },
      hide() { this._visible = false; },
      onClick(fn) { this._handlers.push(fn); },
      offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
    };
    window.__tgSettingsButton = settingsButton;
    window.__tgMainButton = mainButton;
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        MainButton: mainButton,
        SettingsButton: settingsButton,
      },
    };
  });
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

async function setLangPref(page, lang) {
  await page.addInitScript((l) => {
    localStorage.setItem('pref:lang', l);
  }, lang);
}

test.describe('Telegram SettingsButton', () => {
  test('Bridge EN: SettingsButton is shown', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const visible = await page.evaluate(() => window.__tgSettingsButton._visible);
    expect(visible).toBe(true);
  });

  test('Bridge RU: SettingsButton is shown', async ({ page }) => {
    await mockTelegramWebApp(page);
    await setLangPref(page, 'ru');
    await page.goto(distUrl('index.html'));
    const visible = await page.evaluate(() => window.__tgSettingsButton._visible);
    expect(visible).toBe(true);
  });

  test('Exchange EN: SettingsButton is shown', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));
    const visible = await page.evaluate(() => window.__tgSettingsButton._visible);
    expect(visible).toBe(true);
  });

  test('OTC EN: SettingsButton is shown', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));
    const visible = await page.evaluate(() => window.__tgSettingsButton._visible);
    expect(visible).toBe(true);
  });

  test('Settings EN: SettingsButton is hidden', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    const visible = await page.evaluate(() => window.__tgSettingsButton._visible);
    expect(visible).toBe(false);
  });

  test('Settings RU: SettingsButton is hidden', async ({ page }) => {
    await mockTelegramWebApp(page);
    await setLangPref(page, 'ru');
    await page.goto(distUrl('app-settings.html'));
    const visible = await page.evaluate(() => window.__tgSettingsButton._visible);
    expect(visible).toBe(false);
  });

  test('Bridge EN: SettingsButton onClick handler registered', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const handlerCount = await page.evaluate(() => window.__tgSettingsButton._handlers.length);
    expect(handlerCount).toBeGreaterThan(0);
  });

  test('Bridge EN: clicking SettingsButton navigates to app-settings.html', async ({ page }) => {
    await mockTelegramWebApp(page);

    // Capture the destination before navigation happens
    let navigatedTo = null;
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        navigatedTo = frame.url();
      }
    });

    await page.goto(distUrl('index.html'));

    // Invoke the registered SettingsButton handler
    await page.evaluate(() => {
      const handlers = window.__tgSettingsButton._handlers;
      if (handlers.length > 0) handlers[0]();
    });

    // Wait briefly for navigation to settle
    await page.waitForTimeout(200);

    // The navigated URL (or the captured frame URL) should point to app-settings
    const currentUrl = page.url();
    expect(currentUrl).toContain('app-settings');
  });

  test('Settings page: no Settings entry in sidebar menu', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    // The sidebar menu should not contain a link to app-settings (removed from hamburger)
    const settingsMenuLink = page.locator('.modal-dialog a[href*="app-settings"]');
    await expect(settingsMenuLink).toHaveCount(0);
  });
});
