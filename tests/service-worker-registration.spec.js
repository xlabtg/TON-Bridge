import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

async function mockTelegramWebApp(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' }),
  );

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
      },
    };
  });
}

async function captureServiceWorkerSchedule(page, useRequestIdleCallback = true) {
  await page.addInitScript((useRequestIdleCallback) => {
    window.__swRegisterCalls = 0;
    window.__swRegisterUrl = null;
    window.__swDelayFn = null;
    window.__swIdleFn = null;
    window.__swIdleOptions = null;

    Object.defineProperty(Navigator.prototype, 'serviceWorker', {
      configurable: true,
      get() {
        return {
          register(url) {
            window.__swRegisterCalls += 1;
            window.__swRegisterUrl = url;
            return Promise.resolve({});
          },
        };
      },
    });

    const origSetTimeout = window.setTimeout;
    window.setTimeout = function(fn, delay, ...args) {
      if (delay === 3000 && String(fn).includes('registerServiceWorker') && !window.__swDelayFn) {
        window.__swDelayFn = () => fn(...args);
        return 1;
      }
      return origSetTimeout(fn, delay, ...args);
    };

    if (useRequestIdleCallback) {
      window.requestIdleCallback = function(fn, options) {
        window.__swIdleFn = fn;
        window.__swIdleOptions = options;
        return 1;
      };
    } else {
      delete window.requestIdleCallback;
    }
  }, useRequestIdleCallback);
}

test.describe('service worker registration', () => {
  test('is deferred until after load and idle time', async ({ page }) => {
    await mockTelegramWebApp(page);
    await captureServiceWorkerSchedule(page);

    await page.goto(distUrl('index.html'));

    expect(await page.evaluate(() => window.__swRegisterCalls)).toBe(0);
    expect(await page.evaluate(() => typeof window.__swDelayFn)).toBe('function');

    await page.evaluate(() => window.__swDelayFn());

    expect(await page.evaluate(() => window.__swRegisterCalls)).toBe(0);
    expect(await page.evaluate(() => typeof window.__swIdleFn)).toBe('function');
    expect(await page.evaluate(() => window.__swIdleOptions)).toEqual({ timeout: 2000 });

    await page.evaluate(() => window.__swIdleFn());

    expect(await page.evaluate(() => window.__swRegisterCalls)).toBe(1);
    expect(await page.evaluate(() => window.__swRegisterUrl)).toBe('__service-worker.js');
  });
});
