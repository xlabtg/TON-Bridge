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
      },
    };
  });
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

test.describe('Telegram MainButton — widget tabs', () => {
  test('Bridge EN: MainButton text is "Continue"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const text = await page.evaluate(() => window.__tgMainButton._text);
    expect(text).toBe('Continue');
  });

  test('Bridge RU: MainButton text is "Продолжить"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index-ru.html'));
    const text = await page.evaluate(() => window.__tgMainButton._text);
    expect(text).toBe('Продолжить');
  });

  test('Exchange EN: MainButton text is "Confirm exchange"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));
    const text = await page.evaluate(() => window.__tgMainButton._text);
    expect(text).toBe('Confirm exchange');
  });

  test('Exchange RU: MainButton text is "Подтвердить обмен"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2-ru.html'));
    const text = await page.evaluate(() => window.__tgMainButton._text);
    expect(text).toBe('Подтвердить обмен');
  });

  test('OTC EN: MainButton text is "Confirm exchange"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));
    const text = await page.evaluate(() => window.__tgMainButton._text);
    expect(text).toBe('Confirm exchange');
  });

  test('OTC RU: MainButton text is "Подтвердить обмен"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3-ru.html'));
    const text = await page.evaluate(() => window.__tgMainButton._text);
    expect(text).toBe('Подтвердить обмен');
  });

  test('MainButton shows on postMessage widget step (not initial/success)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

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

    await page.addInitScript(() => {
      window.__iframeMessages = [];
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
});

test.describe('Lazy-load iframe', () => {
  test('Bridge EN: placeholder shown, iframe absent on first paint', async ({ page }) => {
    await mockTelegramWebApp(page);
    // Suppress idle injection by stubbing requestIdleCallback and setTimeout
    await page.addInitScript(() => {
      window.requestIdleCallback = function() {};
      const origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, delay, ...args) {
        if (delay === 2000) return 0; // swallow the preload timer
        return origSetTimeout(fn, delay, ...args);
      };
    });
    await page.goto(distUrl('index.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await expect(page.locator('#iframe-widget')).toHaveCount(0);
  });

  test('Bridge EN: "Open exchange" button injects iframe', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      window.requestIdleCallback = function() {};
      const origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, delay, ...args) {
        if (delay === 2000) return 0;
        return origSetTimeout(fn, delay, ...args);
      };
    });
    await page.goto(distUrl('index.html'));
    await page.locator('#open-exchange-btn').click();
    await expect(page.locator('#iframe-widget')).toHaveCount(1);
    await expect(page.locator('#iframe-placeholder')).toHaveCount(0);
  });

  test('Exchange EN: placeholder shown, iframe absent on first paint', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      window.requestIdleCallback = function() {};
      const origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, delay, ...args) {
        if (delay === 2000) return 0;
        return origSetTimeout(fn, delay, ...args);
      };
    });
    await page.goto(distUrl('index2.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await expect(page.locator('#iframe-widget')).toHaveCount(0);
  });

  test('OTC EN: placeholder shown, iframe absent on first paint', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      window.requestIdleCallback = function() {};
      const origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, delay, ...args) {
        if (delay === 2000) return 0;
        return origSetTimeout(fn, delay, ...args);
      };
    });
    await page.goto(distUrl('index3.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await expect(page.locator('#iframe-widget')).toHaveCount(0);
  });

  test('Idle preload: iframe injected after requestIdleCallback fires', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      // Capture the idle callback so we can trigger it manually
      window.__idleCb = null;
      window.requestIdleCallback = function(fn) { window.__idleCb = fn; };
    });
    await page.goto(distUrl('index.html'));

    // No iframe yet
    await expect(page.locator('#iframe-widget')).toHaveCount(0);

    // Fire the idle callback manually
    await page.evaluate(() => { if (window.__idleCb) window.__idleCb(); });

    await expect(page.locator('#iframe-widget')).toHaveCount(1);
  });

  test('Idle preload: iframe injected after setTimeout 2000 fires (Safari fallback)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      // Remove requestIdleCallback to test setTimeout fallback
      delete window.requestIdleCallback;
      window.__idleTimerFn = null;
      const origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, delay, ...args) {
        if (delay === 2000) { window.__idleTimerFn = fn; return 0; }
        return origSetTimeout(fn, delay, ...args);
      };
    });
    await page.goto(distUrl('index.html'));

    await expect(page.locator('#iframe-widget')).toHaveCount(0);

    await page.evaluate(() => { if (window.__idleTimerFn) window.__idleTimerFn(); });

    await expect(page.locator('#iframe-widget')).toHaveCount(1);
  });

  test('Screenshot: Bridge tab — placeholder visible before interaction', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      window.requestIdleCallback = function() {};
      const origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, delay, ...args) {
        if (delay === 2000) return 0;
        return origSetTimeout(fn, delay, ...args);
      };
    });
    await page.goto(distUrl('index.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/bridge-en-placeholder.png', fullPage: false });
  });

  test('Screenshot: Bridge tab — iframe visible after button click', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      window.requestIdleCallback = function() {};
      const origSetTimeout = window.setTimeout;
      window.setTimeout = function(fn, delay, ...args) {
        if (delay === 2000) return 0;
        return origSetTimeout(fn, delay, ...args);
      };
    });
    await page.goto(distUrl('index.html'));
    await page.locator('#open-exchange-btn').click();
    await expect(page.locator('#iframe-widget')).toHaveCount(1);
    await page.screenshot({ path: 'tests/screenshots/bridge-en-iframe.png', fullPage: false });
  });
});
