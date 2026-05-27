import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

function distPath(file) {
  return resolve(__dirname, '..', 'dist', file);
}

async function waitForDistFile(file) {
  await expect.poll(() => existsSync(distPath(file)), { timeout: 30000 }).toBe(true);
}

async function waitForDistStyleReset() {
  await expect.poll(() => {
    const cssFile = distPath('assets/css/style.css');
    return existsSync(cssFile) && readFileSync(cssFile, 'utf8').includes('overflow-x:hidden;margin:0');
  }, { timeout: 30000 }).toBe(true);
}

async function seedStoredConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem('FinappConsent', JSON.stringify({
      version: 1,
      analytics: false,
      marketing: false,
      ts: Date.now(),
    }));
  });
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
        switchInlineQuery() {},
      },
    };
  }, { userId, adminIds });
}

test.describe('Layout regressions', () => {
  test('static app shells reset browser body margin consistently', async ({ page }) => {
    await mockTelegramWebApp(page);
    await waitForDistStyleReset();
    await page.route('https://ton-bridge-worker.tonbankcard.workers.dev/api/balance*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ points: 0, ton_address: null, redemptions: [] }),
    }));
    await page.route('https://ton-bridge-worker.tonbankcard.workers.dev/api/referral*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ref_code: 'ABC123',
        ref_share_url: 'https://t.me/TONBridge_robot/app?startapp=ref_ABC123',
        points_per_tbc: 10,
        pending_points: 0,
        pending_tbc: 0,
      }),
    }));

    for (const file of ['redeem.html', 'referral.html', 'program.html']) {
      await waitForDistFile(file);
      await page.goto(distUrl(file));

      await expect.poll(
        () => page.evaluate(() => getComputedStyle(document.body).margin),
        { message: `${file} should not keep the browser default body margin` },
      ).toBe('0px');
    }
  });

  test('left sidebar does not expose hidden offcanvas panels', async ({ page }) => {
    await mockTelegramWebApp(page);
    await seedStoredConsent(page);
    await page.setViewportSize({ width: 1360, height: 768 });
    await waitForDistFile('index-ru.html');
    await page.goto(distUrl('index-ru.html'));

    await expect(page.locator('#address-book-action-sheet')).toBeHidden();
    await expect(page.locator('#cookiesbox')).toBeHidden();

    await page.locator('[data-bs-target="#sidebarPanel"]').click();
    await expect(page.locator('#sidebarPanel')).toHaveClass(/show/);
    await expect(page.locator('#support-link')).toBeVisible();

    await expect(page.locator('#address-book-action-sheet')).toBeHidden();
    await expect(page.locator('#cookiesbox')).toBeHidden();

    const layout = await page.evaluate(() => {
      const sidebar = document.querySelector('#sidebarPanel .modal-content').getBoundingClientRect();
      return {
        sidebarLeft: sidebar.left,
        sidebarRight: sidebar.right,
      };
    });

    expect(layout.sidebarLeft).toBeGreaterThanOrEqual(0);
    expect(layout.sidebarRight).toBeLessThanOrEqual(300);
  });

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

test.describe('Privacy consent modal for issue #144', () => {
  test('desktop first visit shows centered popup and stores the selected consent', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.setViewportSize({ width: 1360, height: 768 });
    await page.goto(distUrl('index-ru.html'));

    const popup = page.locator('#cookiesbox');
    await expect(popup).toHaveClass(/modal/);
    await expect(popup).toHaveClass(/show/, { timeout: 3500 });

    const geometry = await page.locator('#cookiesbox .modal-content').evaluate(content => {
      const rect = content.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        centerDelta: Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2),
      };
    });
    expect(geometry.width).toBeLessThanOrEqual(620);
    expect(geometry.centerDelta).toBeLessThanOrEqual(1);
    expect(geometry.left).toBeGreaterThanOrEqual(16);
    expect(geometry.right).toBeLessThanOrEqual(1344);
    expect(geometry.top).toBeGreaterThanOrEqual(16);
    expect(geometry.bottom).toBeLessThanOrEqual(752);

    await page.locator('.accept-selected-cookies').click();
    await expect(popup).not.toHaveClass(/show/);

    const storedConsent = await page.evaluate(() => JSON.parse(localStorage.getItem('FinappConsent')));
    expect(storedConsent).toMatchObject({ version: 1, analytics: false, marketing: false });

    await page.reload();
    await page.waitForTimeout(1800);
    await expect(page.locator('#cookiesbox')).not.toHaveClass(/show/);
  });

  test('mobile popup keeps consent controls and actions inside the viewport', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distUrl('index.html'));

    const popup = page.locator('#cookiesbox');
    await expect(popup).toHaveClass(/modal/);
    await expect(popup).toHaveClass(/show/, { timeout: 3500 });

    const popupBounds = await page.locator('#cookiesbox .modal-content').evaluate(content => {
      const rect = content.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    expect(popupBounds.left).toBeGreaterThanOrEqual(8);
    expect(popupBounds.right).toBeLessThanOrEqual(382);
    expect(popupBounds.top).toBeGreaterThanOrEqual(8);
    expect(popupBounds.bottom).toBeLessThanOrEqual(836);

    const overflowingControls = await page.locator('#cookiesbox .form-switch .form-check-label')
      .evaluateAll(labels => labels.map(label => {
        const rect = label.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      }).filter(rect => (
        rect.left < 0 ||
        rect.right > rect.viewportWidth ||
        rect.top < 0 ||
        rect.bottom > rect.viewportHeight
      )));
    expect(overflowingControls).toEqual([]);

    const actionOverflow = await page.locator('#cookiesbox .buttons').evaluate(buttons => {
      const rect = buttons.getBoundingClientRect();
      return rect.left < 0 || rect.right > window.innerWidth || rect.top < 0 || rect.bottom > window.innerHeight;
    });
    expect(actionOverflow).toBe(false);
  });
});
