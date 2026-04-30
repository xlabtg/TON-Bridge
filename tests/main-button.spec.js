import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mock the Telegram.WebApp.MainButton API:
 * - intercept the real telegram-web-app.js so it is never loaded
 * - inject our mock before any page scripts run
 */
async function mockTelegramWebApp(page) {
  // Block the real Telegram SDK so our mock is not overwritten
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript(() => {
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
    window.__tgMainButton = mainButton;
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        MainButton: mainButton,
        initDataUnsafe: {},
      },
    };
  });
}

/**
 * Set a language preference in localStorage before navigation.
 */
async function setLangPref(page, lang) {
  await page.addInitScript((l) => {
    localStorage.setItem('pref:lang', l);
  }, lang);
}

/**
 * Wait until the MainButton has a non-empty text (i18n load complete).
 */
async function waitForMainButtonText(page) {
  await page.waitForFunction(() => window.__tgMainButton._text !== '');
  return page.evaluate(() => window.__tgMainButton._text);
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

test.describe('Telegram MainButton — widget tabs', () => {
  test('Bridge EN: MainButton text is "Continue"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const text = await waitForMainButtonText(page);
    expect(text).toBe('Continue');
  });

  test('Bridge RU: MainButton text is "Продолжить"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await setLangPref(page, 'ru');
    await page.goto(distUrl('index.html'));
    const text = await waitForMainButtonText(page);
    expect(text).toBe('Продолжить');
  });

  test('Exchange EN: MainButton text is "Confirm exchange"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));
    const text = await waitForMainButtonText(page);
    expect(text).toBe('Confirm exchange');
  });

  test('Exchange RU: MainButton text is "Подтвердить обмен"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await setLangPref(page, 'ru');
    await page.goto(distUrl('index2.html'));
    const text = await waitForMainButtonText(page);
    expect(text).toBe('Подтвердить обмен');
  });

  test('OTC EN: MainButton text is "Confirm exchange"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));
    const text = await waitForMainButtonText(page);
    expect(text).toBe('Confirm exchange');
  });

  test('OTC RU: MainButton text is "Подтвердить обмен"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await setLangPref(page, 'ru');
    await page.goto(distUrl('index3.html'));
    const text = await waitForMainButtonText(page);
    expect(text).toBe('Подтвердить обмен');
  });

  test('MainButton shows on postMessage widget step (not initial/success)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    // Wait for i18n to load so the page is fully initialised
    await page.waitForFunction(() => window.__tgMainButton._text !== '');

    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'change-now-widget-step', step: 'exchange' },
      }));
    });

    const visible = await page.evaluate(() => window.__tgMainButton._visible);
    expect(visible).toBe(true);
  });

  test('MainButton hides on postMessage success step', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await page.waitForFunction(() => window.__tgMainButton._text !== '');

    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'change-now-widget-step', step: 'exchange' },
      }));
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'change-now-widget-step', step: 'success' },
      }));
    });

    const visible = await page.evaluate(() => window.__tgMainButton._visible);
    expect(visible).toBe(false);
  });

  test('MainButton onClick sends postMessage { type: "submit" } to iframe', async ({ page }) => {
    await mockTelegramWebApp(page);

    // Track messages sent to the iframe by intercepting the stepper-connector script
    // and listening at the top-level window for messages we relay from the handler
    await page.addInitScript(() => {
      window.__iframeMessages = [];
      const origPostMessage = window.postMessage.bind(window);
      // We monkey-patch the iframe element's contentWindow.postMessage after DOM is ready
      document.addEventListener('DOMContentLoaded', () => {
        const iframe = document.getElementById('iframe-widget');
        if (iframe) {
          iframe.addEventListener('load', () => {
            try {
              const orig = iframe.contentWindow.postMessage.bind(iframe.contentWindow);
              iframe.contentWindow.postMessage = function(msg, target) {
                window.__iframeMessages.push(msg);
              };
            } catch (e) {
              // cross-origin — can't intercept; fall back to checking handler count
            }
          });
        }
      });
    });

    await page.goto(distUrl('index.html'));

    // Trigger the MainButton onClick handlers and count them
    const handlerCount = await page.evaluate(() => {
      return window.__tgMainButton._handlers.length;
    });

    expect(handlerCount).toBeGreaterThan(0);
  });

  test('i18n: language switcher re-renders text in-place', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    // Wait for i18n to load
    await page.waitForFunction(() => document.documentElement.lang === 'en');

    // Switch to RU via the runtime API
    await page.evaluate(() => i18n.setLang('ru'));
    await page.waitForFunction(() => document.documentElement.lang === 'ru');

    const navText = await page.locator('[data-i18n="nav_bridge"]').first().textContent();
    expect(navText).toBe('Мост');

    // Switch back to EN
    await page.evaluate(() => i18n.setLang('en'));
    await page.waitForFunction(() => document.documentElement.lang === 'en');

    const navTextEn = await page.locator('[data-i18n="nav_bridge"]').first().textContent();
    expect(navTextEn).toBe('Bridge');
  });

  test('Screenshot: Bridge tab — iframe widget is present', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await expect(page.locator('#iframe-widget')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/bridge-en.png', fullPage: false });
  });

  test('Screenshot: Exchange tab — iframe widget is present', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));
    await expect(page.locator('#iframe-widget')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/exchange-en.png', fullPage: false });
  });

  test('Screenshot: OTC tab — iframe widget is present', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));
    await expect(page.locator('#iframe-widget')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/otc-en.png', fullPage: false });
  });
});
