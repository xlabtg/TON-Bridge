import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const deepLinkSrc = readFileSync(resolve(__dirname, '../assets/js/deep-link.js'), 'utf8');

/**
 * Inject the deep-link module into a blank page so we can call
 * TonBridgeDeepLink.parse() directly without a full build.
 */
async function loadParser(page) {
  await page.goto('about:blank');
  await page.evaluate(deepLinkSrc);
}

test.describe('TonBridgeDeepLink.parse — positive cases', () => {
  test('bridge preset', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('bridge_ton_tonbsc_10')
    );
    expect(result).toEqual({ type: 'bridge', from: 'ton', to: 'tonbsc', amount: '10' });
  });

  test('bridge preset with decimal amount', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('bridge_ton_tonbsc_0.5')
    );
    expect(result).toEqual({ type: 'bridge', from: 'ton', to: 'tonbsc', amount: '0.5' });
  });

  test('exchange preset', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('exchange_btc_ton_0.1')
    );
    expect(result).toEqual({ type: 'exchange', from: 'btc', to: 'ton', amount: '0.1' });
  });

  test('otc preset', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('otc_usdtton_ton_1000000')
    );
    expect(result).toEqual({ type: 'otc', from: 'usdtton', to: 'ton', amount: '1000000' });
  });

  test('order preset', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('order_abc123')
    );
    expect(result).toEqual({ type: 'order', id: 'abc123' });
  });

  test('order id with hyphens', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('order_abc-123-xyz')
    );
    expect(result).toEqual({ type: 'order', id: 'abc-123-xyz' });
  });

  test('ref preset', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('ref_A1B2C3D4')
    );
    expect(result).toEqual({ type: 'ref', code: 'A1B2C3D4' });
  });
});

test.describe('TonBridgeDeepLink.parse — negative / validation cases', () => {
  test('returns null for null', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() => window.TonBridgeDeepLink.parse(null));
    expect(result).toBeNull();
  });

  test('returns null for empty string', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() => window.TonBridgeDeepLink.parse(''));
    expect(result).toBeNull();
  });

  test('returns null for unknown prefix', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('swap_ton_tonbsc_10')
    );
    expect(result).toBeNull();
  });

  test('rejects param longer than 64 chars', async ({ page }) => {
    await loadParser(page);
    const long = 'bridge_ton_tonbsc_' + '1'.repeat(50);
    const result = await page.evaluate((p) => window.TonBridgeDeepLink.parse(p), long);
    expect(result).toBeNull();
  });

  test('rejects unknown from-asset', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('bridge_unknown_tonbsc_10')
    );
    expect(result).toBeNull();
  });

  test('rejects unknown to-asset', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('bridge_ton_unknown_10')
    );
    expect(result).toBeNull();
  });

  test('rejects non-numeric amount', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('bridge_ton_tonbsc_abc')
    );
    expect(result).toBeNull();
  });

  test('rejects negative amount', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('bridge_ton_tonbsc_-10')
    );
    expect(result).toBeNull();
  });

  test('rejects bridge with missing amount', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('bridge_ton_tonbsc')
    );
    expect(result).toBeNull();
  });

  test('rejects order with invalid id chars', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('order_abc!@#')
    );
    expect(result).toBeNull();
  });

  test('rejects ref with too-short code', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('ref_AB')
    );
    expect(result).toBeNull();
  });

  test('rejects ref with special characters', async ({ page }) => {
    await loadParser(page);
    const result = await page.evaluate(() =>
      window.TonBridgeDeepLink.parse('ref_abc!def')
    );
    expect(result).toBeNull();
  });
});

test.describe('TonBridgeDeepLink.buildUrl', () => {
  test('returns correct t.me URL', async ({ page }) => {
    await loadParser(page);
    const url = await page.evaluate(() =>
      window.TonBridgeDeepLink.buildUrl('bridge_ton_tonbsc_10')
    );
    expect(url).toBe('https://t.me/TONBridge_robot/app?startapp=bridge_ton_tonbsc_10');
  });

  test('URL-encodes special characters', async ({ page }) => {
    await loadParser(page);
    const url = await page.evaluate(() =>
      window.TonBridgeDeepLink.buildUrl('ref_A B')
    );
    expect(url).toContain('startapp=ref_A%20B');
  });
});

test.describe('TonBridgeDeepLink.init — widget prefill via hash redirect', () => {
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
          initDataUnsafe: {},
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

  test('prefills iframe src from hash redirect payload on Bridge page', async ({ page }) => {
    await mockTelegramWebApp(page);
    const url = distUrl('index.html') + '#dl=' + encodeURIComponent(
      JSON.stringify({ type: 'bridge', from: 'ton', to: 'tonbsc', amount: '5' })
    );
    await page.goto(url);
    const src = await page.evaluate(() => {
      const iframe = document.getElementById('iframe-widget');
      return iframe ? iframe.src : null;
    });
    expect(src).toContain('from=ton');
    expect(src).toContain('to=tonbsc');
    expect(src).toContain('amount=5');
  });

  test('prefills iframe src from start_param on Bridge page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      window.Telegram.WebApp.initDataUnsafe = { start_param: 'bridge_ton_tonbsc_7' };
    });
    await page.goto(distUrl('index.html'));
    const src = await page.evaluate(() => {
      const iframe = document.getElementById('iframe-widget');
      return iframe ? iframe.src : null;
    });
    expect(src).toContain('from=ton');
    expect(src).toContain('to=tonbsc');
    expect(src).toContain('amount=7');
  });

  test('does not modify iframe when start_param is unrecognised', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      window.Telegram.WebApp.initDataUnsafe = { start_param: 'totally_invalid' };
    });
    await page.goto(distUrl('index.html'));
    const state = await page.evaluate(() => {
      return {
        hasIframe: Boolean(document.getElementById('iframe-widget')),
        hasPlaceholder: Boolean(document.getElementById('iframe-placeholder')),
      };
    });
    expect(state).toEqual({ hasIframe: false, hasPlaceholder: true });
  });

  test('stores ref code in sessionStorage', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      window.Telegram.WebApp.initDataUnsafe = { start_param: 'ref_ABCD1234' };
    });
    await page.goto(distUrl('index.html'));
    const code = await page.evaluate(() => sessionStorage.getItem('tg_ref_code'));
    expect(code).toBe('ABCD1234');
  });
});
