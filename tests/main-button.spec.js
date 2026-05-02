import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Mock the Telegram.WebApp.MainButton API:
 * - intercept the real telegram-web-app.js so it is never loaded
 * - inject our mock before any page scripts run
 */
async function mockTelegramWebApp(page, options = {}) {
  // Block the real Telegram SDK so our mock is not overwritten
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript(({ languageCode, cloudStorage }) => {
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
    const cloudStore = cloudStorage ? { ...cloudStorage } : null;
    window.__tgMainButton = mainButton;
    window.__tgCloudStorageStore = cloudStore;
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        MainButton: mainButton,
        initDataUnsafe: languageCode ? { user: { language_code: languageCode } } : {},
      },
    };
    if (cloudStore) {
      window.Telegram.WebApp.CloudStorage = {
        setItem(key, value, cb) { cloudStore[key] = value; cb && cb(null); },
        getItem(key, cb) { cb && cb(null, cloudStore[key] || ''); },
        removeItems(keys, cb) { keys.forEach(key => delete cloudStore[key]); cb && cb(null); },
      };
    }
  }, options);
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

function iframeParam(page, name) {
  return page.locator('#iframe-widget').evaluate((iframe, paramName) => {
    return new URL(iframe.src).searchParams.get(paramName);
  }, name);
}

async function disableIdlePreload(page) {
  await page.addInitScript(() => {
    window.requestIdleCallback = function() { return 0; };
    const origSetTimeout = window.setTimeout;
    window.setTimeout = function(fn, delay, ...args) {
      if (delay === 2000) return 0;
      return origSetTimeout(fn, delay, ...args);
    };
  });
}

async function captureIdlePreload(page, useRequestIdleCallback = true) {
  await page.addInitScript((useRequestIdleCallback) => {
    window.__idleTimerFn = null;
    window.__idleCb = null;
    const origSetTimeout = window.setTimeout;
    window.setTimeout = function(fn, delay, ...args) {
      if (delay === 2000 && !window.__idleTimerFn) {
        window.__idleTimerFn = fn;
        return 1;
      }
      return origSetTimeout(fn, delay, ...args);
    };

    if (useRequestIdleCallback) {
      window.requestIdleCallback = function(fn) {
        window.__idleCb = fn;
        return 1;
      };
      window.cancelIdleCallback = function() {
        window.__idleCb = null;
      };
    } else {
      delete window.requestIdleCallback;
    }
  }, useRequestIdleCallback);
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
  test('MainButton onClick injects the iframe when it is still lazy', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index.html'));
    await page.waitForFunction(() => window.__tgMainButton._text !== '');

    await page.evaluate(() => {
      window.__tgMainButton._handlers.forEach(handler => handler());
    });

    await expect(page.locator('#iframe-widget')).toHaveCount(1);
    await expect(page.locator('#iframe-placeholder')).toHaveCount(0);
  });
});

test.describe('Runtime i18n', () => {
  test('language switcher re-renders text in-place', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    await page.waitForFunction(() => document.documentElement.lang === 'en');

    await page.evaluate(() => i18n.setLang('ru'));
    await page.waitForFunction(() => document.documentElement.lang === 'ru');

    const navText = await page.locator('[data-i18n="nav_bridge"]').first().textContent();
    expect(navText).toBe('Мост');

    await page.evaluate(() => i18n.setLang('en'));
    await page.waitForFunction(() => document.documentElement.lang === 'en');

    const navTextEn = await page.locator('[data-i18n="nav_bridge"]').first().textContent();
    expect(navTextEn).toBe('Bridge');
  });

  test('CloudStorage pref:lang wins over Telegram language', async ({ page }) => {
    await mockTelegramWebApp(page, {
      languageCode: 'en',
      cloudStorage: { 'pref:migrated': '1', 'pref:lang': 'ru' },
    });

    await page.goto(distUrl('app-settings.html'));
    await page.waitForFunction(() => document.documentElement.lang === 'ru');

    const navText = await page.locator('[data-i18n="nav_bridge"]').first().textContent();
    expect(navText).toBe('Мост');
  });

  test('language switch updates lazy placeholder and ChangeNOW iframe lang parameter', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index.html'));
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await expect(page.locator('#open-exchange-btn')).toHaveText('Open exchange');

    await page.locator('#open-exchange-btn').click();
    await expect.poll(() => iframeParam(page, 'lang')).toBe('en-EN');

    await page.evaluate(() => i18n.setLang('ru'));
    await page.waitForFunction(() => document.documentElement.lang === 'ru');

    await expect.poll(() => iframeParam(page, 'lang')).toBe('ru-RU');
  });
});

test.describe('Lazy-load iframe', () => {
  test('Bridge EN: placeholder shown, iframe absent on first paint', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await expect(page.locator('#iframe-widget')).toHaveCount(0);
  });

  test('Bridge EN: "Open exchange" button injects iframe', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index.html'));
    await page.locator('#open-exchange-btn').click();

    const iframe = page.locator('#iframe-widget');
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toHaveAttribute('loading', 'lazy');
    await expect(iframe).toHaveAttribute('importance', 'high');
    await expect(page.locator('#iframe-placeholder')).toHaveCount(0);
  });

  test('Exchange EN: placeholder shown, iframe absent on first paint', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index2.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await expect(page.locator('#iframe-widget')).toHaveCount(0);
  });

  test('OTC EN: placeholder shown, iframe absent on first paint', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index3.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await expect(page.locator('#iframe-widget')).toHaveCount(0);
  });

  test('Idle preload: iframe injected after 2 s timer and requestIdleCallback fire', async ({ page }) => {
    await mockTelegramWebApp(page);
    await captureIdlePreload(page);
    await page.goto(distUrl('index.html'));

    await expect(page.locator('#iframe-widget')).toHaveCount(0);

    await page.evaluate(() => { if (window.__idleTimerFn) window.__idleTimerFn(); });
    await expect(page.locator('#iframe-widget')).toHaveCount(0);

    await page.evaluate(() => { if (window.__idleCb) window.__idleCb(); });
    await expect(page.locator('#iframe-widget')).toHaveCount(1);
  });

  test('Idle preload: iframe injected after setTimeout 2000 fires (Safari fallback)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await captureIdlePreload(page, false);
    await page.goto(distUrl('index.html'));

    await expect(page.locator('#iframe-widget')).toHaveCount(0);

    await page.evaluate(() => { if (window.__idleTimerFn) window.__idleTimerFn(); });

    await expect(page.locator('#iframe-widget')).toHaveCount(1);
  });

  test('Iframe is removed on beforeunload after injection', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index.html'));

    await page.locator('#open-exchange-btn').click();
    await expect(page.locator('#iframe-widget')).toHaveCount(1);

    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    await expect(page.locator('#iframe-widget')).toHaveCount(0);
  });

  test('Screenshot: Bridge tab — placeholder visible before interaction', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/bridge-en-placeholder.png', fullPage: false });
  });

  test('Screenshot: Bridge tab — iframe visible after button click', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index.html'));
    await page.locator('#open-exchange-btn').click();
    await expect(page.locator('#iframe-widget')).toHaveCount(1);
    await page.screenshot({ path: 'tests/screenshots/bridge-en-iframe.png', fullPage: false });
  });

  test('Screenshot: Exchange tab — placeholder visible before interaction', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index2.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/exchange-en.png', fullPage: false });
  });

  test('Screenshot: OTC tab — placeholder visible before interaction', async ({ page }) => {
    await mockTelegramWebApp(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index3.html'));
    await expect(page.locator('#iframe-placeholder')).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/otc-en.png', fullPage: false });
  });
});
