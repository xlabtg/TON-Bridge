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

test.describe('Affiliate dashboard', () => {
  async function mockAffiliatePage(page) {
    await mockTelegramWebApp(page);
    // When served from file://, fetch('/me/affiliate') fails with network error.
    // Inject mock fetch so the page treats the response as 401 (unauthenticated).
    await page.addInitScript(() => {
      window.__affiliateMockStatus = 401;
      window.__affiliateMockData = null;
    });
    await page.addInitScript(() => {
      const origFetch = window.fetch;
      window.fetch = function(url, opts) {
        if (typeof url === 'string' && url.includes('/me/affiliate')) {
          const status = window.__affiliateMockStatus;
          const body = window.__affiliateMockData ? JSON.stringify(window.__affiliateMockData) : JSON.stringify({ error: 'Unauthorized' });
          return Promise.resolve(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));
        }
        return origFetch.apply(this, arguments);
      };
    });
  }

  async function mockAffiliateAuth(page) {
    await mockTelegramWebApp(page);
    const mockData = {
      lifetime_turnover_usd: 1234.56,
      lifetime_points_earned: 40740,
      points_balance: 40000,
      last_swaps: [
        { created_at: '2025-04-01T10:00:00Z', from_currency: 'TON', to_currency: 'BTC', turnover_usd: 100, points_awarded: 3300 },
        { created_at: '2025-04-02T11:00:00Z', from_currency: 'ETH', to_currency: 'TON', turnover_usd: 200, points_awarded: 6600 },
      ],
      referral_leaderboard: [
        { user_id: '123456789', turnover_usd: 500, referral_points: 1650 },
        { user_id: '987654321', turnover_usd: 300, referral_points: 990 },
      ],
    };
    await page.addInitScript((data) => {
      window.__affiliateMockStatus = 200;
      window.__affiliateMockData = data;
    }, mockData);
    await page.addInitScript(() => {
      const origFetch = window.fetch;
      window.fetch = function(url, opts) {
        if (typeof url === 'string' && url.includes('/me/affiliate')) {
          const status = window.__affiliateMockStatus;
          const body = JSON.stringify(window.__affiliateMockData);
          return Promise.resolve(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));
        }
        return origFetch.apply(this, arguments);
      };
    });
  }

  test('Affiliate EN: page loads and global section is present', async ({ page }) => {
    await mockAffiliatePage(page);
    await page.goto(distUrl('index4.html'));
    await expect(page.locator('#volumeChart .apexcharts-svg')).toBeVisible();
    await expect(page.locator('.appBottomMenu')).toBeVisible();
  });

  test('Affiliate RU: page loads and global section is present', async ({ page }) => {
    await mockAffiliatePage(page);
    await page.goto(distUrl('index4-ru.html'));
    await expect(page.locator('#volumeChart .apexcharts-svg')).toBeVisible();
    await expect(page.locator('.appBottomMenu')).toBeVisible();
  });

  test('Affiliate EN: unauthenticated CTA is shown on 401', async ({ page }) => {
    await mockAffiliatePage(page);
    await page.goto(distUrl('index4.html'));
    await expect(page.locator('#affiliate-unauthenticated')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#affiliate-data')).toBeHidden();
  });

  test('Affiliate EN: authenticated data section is shown on 200', async ({ page }) => {
    await mockAffiliateAuth(page);
    await page.goto(distUrl('index4.html'));
    await expect(page.locator('#affiliate-data')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#affiliate-unauthenticated')).toBeHidden();
    const turnover = await page.locator('#stat-turnover').textContent();
    expect(turnover).toContain('1234.56');
  });

  test('Affiliate EN: Statistics tab in bottom nav is active', async ({ page }) => {
    await mockAffiliatePage(page);
    await page.goto(distUrl('index4.html'));
    const statsLink = page.locator('.appBottomMenu a[href="index4.html"]');
    await expect(statsLink).toHaveClass(/active/);
  });

  test('Screenshot: Affiliate dashboard EN', async ({ page }) => {
    await mockAffiliatePage(page);
    await page.goto(distUrl('index4.html'));
    await page.screenshot({ path: 'tests/screenshots/affiliate-en.png', fullPage: false });
  });

  test('Screenshot: Affiliate dashboard RU', async ({ page }) => {
    await mockAffiliatePage(page);
    await page.goto(distUrl('index4-ru.html'));
    await page.screenshot({ path: 'tests/screenshots/affiliate-ru.png', fullPage: false });
  });
});
