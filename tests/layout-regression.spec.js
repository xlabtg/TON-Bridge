import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

async function mockTelegramWebApp(page, options = {}) {
  const userId = options.userId || '12345';
  const adminIds = options.adminIds || ['12345'];

  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));
  await page.route('https://tganalytics.xyz/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* analytics mocked */',
  }));
  await page.route('https://mc.yandex.ru/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* metrika mocked */',
  }));
  await page.route('https://changenow.io/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<html><body>ChangeNOW</body></html>',
  }));
  await page.route('https://ton.app/a2/badge/topapp?appId=2722', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="136" height="72"></svg>',
  }));

  await page.addInitScript(({ userId, adminIds }) => {
    window.__adminIds = adminIds;
    window.requestIdleCallback = function () { return 0; };
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = function (fn, delay, ...args) {
      if (delay === 2000) return 0;
      return originalSetTimeout(fn, delay, ...args);
    };
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        initDataUnsafe: userId ? { user: { id: Number(userId) } } : {},
        MainButton: {
          setText() {},
          show() {},
          hide() {},
          onClick() {},
          offClick() {},
          setParams() {},
          enable() {},
          disable() {},
        },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        SettingsButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: {
          notificationOccurred() {},
          impactOccurred() {},
          selectionChanged() {},
        },
        CloudStorage: {
          setItem(_key, _value, cb) { if (cb) cb(null); },
          getItem(_key, cb) { if (cb) cb(null, ''); },
        },
      },
    };
  }, { userId, adminIds });
}

test.describe('Layout regressions for issue #140 follow-up', () => {
  test('mobile RU settings keeps switches and payout actions inside the cards', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distUrl('app-settings-ru.html'));

    await expect(page.locator('.settings-screen')).toBeVisible();

    const switchOverflow = await page.locator('.settings-screen .form-switch .form-check-label')
      .evaluateAll(labels => labels.map(label => {
        const rect = label.getBoundingClientRect();
        const card = label.closest('.listview.inset').getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          cardLeft: card.left,
          cardRight: card.right,
        };
      }).filter(item => item.left < item.cardLeft - 0.5 || item.right > item.cardRight + 0.5));
    expect(switchOverflow).toEqual([]);

    const payoutOverlap = await page.locator('#wallet-payout-empty-row .in').evaluate(row => {
      const text = row.querySelector('small').getBoundingClientRect();
      const button = row.querySelector('button').getBoundingClientRect();
      return !(button.bottom <= text.top || button.top >= text.bottom || button.right <= text.left || button.left >= text.right);
    });
    expect(payoutOverlap).toBe(false);
  });

  test('desktop exchange actions are centered below the exchange form', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(distUrl('index2.html'));
    await page.locator('#open-exchange-btn').click();

    const stack = page.locator('.exchange-action-stack');
    await expect(stack).toBeVisible();
    await expect(page.locator('#send-to-chat-btn')).toBeVisible();

    const centerDelta = await stack.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return Math.abs((rect.left + rect.width / 2) - (window.innerWidth / 2));
    });
    expect(centerDelta).toBeLessThanOrEqual(1);
  });
});
