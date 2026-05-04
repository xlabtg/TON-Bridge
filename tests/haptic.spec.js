import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    const hapticLog = [];
    window.__hapticLog = hapticLog;

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
        HapticFeedback: {
          impactOccurred(style) { hapticLog.push({ type: 'impact', style }); },
          notificationOccurred(t) { hapticLog.push({ type: 'notification', notificationType: t }); },
          selectionChanged() { hapticLog.push({ type: 'selection' }); },
        },
      },
    };
  });
}

test.describe('HapticFeedback — safeHaptic helper', () => {
  test('haptic.impact fires impactOccurred on Bridge page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

    await page.evaluate(() => haptic.impact('light'));
    const log = await page.evaluate(() => window.__hapticLog);
    expect(log).toContainEqual({ type: 'impact', style: 'light' });
  });

  test('haptic.notification fires notificationOccurred on Bridge page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

    await page.evaluate(() => haptic.notification('success'));
    const log = await page.evaluate(() => window.__hapticLog);
    expect(log).toContainEqual({ type: 'notification', notificationType: 'success' });
  });

  test('haptic.selection fires selectionChanged on Settings page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));

    await page.evaluate(() => haptic.selection());
    const log = await page.evaluate(() => window.__hapticLog);
    expect(log).toContainEqual({ type: 'selection' });
  });

  test('safeHaptic does not throw when Telegram is undefined', async ({ page }) => {
    // No Telegram mock — real telegram-web-app.js is blocked, no global injected
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* mocked */',
    }));

    await page.goto(distUrl('app-settings.html'));

    const threw = await page.evaluate(() => {
      try {
        window.Telegram = undefined;
        haptic.impact('light');
        haptic.notification('error');
        haptic.selection();
        return false;
      } catch (e) {
        return true;
      }
    });
    expect(threw).toBe(false);
  });
});

test.describe('HapticFeedback — tab-bar taps', () => {
  test('Clicking a tab-bar item on Bridge page fires impact(light)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

    // Prevent navigation so we can read the log after the click
    await page.evaluate(() => {
      document.querySelectorAll('.appBottomMenu .item').forEach(function (el) {
        el.addEventListener('click', function (e) { e.preventDefault(); });
      });
    });

    await page.click('.appBottomMenu .item:nth-child(2)');
    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'impact' && e.style === 'light')).toBe(true);
  });

  test('Clicking a tab-bar item on Exchange page fires impact(light)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));

    await page.evaluate(() => {
      document.querySelectorAll('.appBottomMenu .item').forEach(function (el) {
        el.addEventListener('click', function (e) { e.preventDefault(); });
      });
    });

    await page.click('.appBottomMenu .item:nth-child(1)');
    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'impact' && e.style === 'light')).toBe(true);
  });

  test('Clicking a tab-bar item on OTC page fires impact(light)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));

    await page.evaluate(() => {
      document.querySelectorAll('.appBottomMenu .item').forEach(function (el) {
        el.addEventListener('click', function (e) { e.preventDefault(); });
      });
    });

    await page.click('.appBottomMenu .item:nth-child(1)');
    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'impact' && e.style === 'light')).toBe(true);
  });

  test('Clicking a tab-bar item on Settings page fires impact(light)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));

    await page.evaluate(() => {
      document.querySelectorAll('.appBottomMenu .item').forEach(function (el) {
        el.addEventListener('click', function (e) { e.preventDefault(); });
      });
    });

    await page.click('.appBottomMenu .item:nth-child(1)');
    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'impact' && e.style === 'light')).toBe(true);
  });
});

test.describe('HapticFeedback — settings toggles', () => {
  test('Dark mode toggle fires selectionChanged', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));

    // The checkbox is visually hidden (toggled via label); fire the change event directly
    await page.evaluate(() => {
      document.getElementById('darkmodeSwitch').dispatchEvent(new Event('change'));
    });
    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'selection')).toBe(true);
  });

  test('Language switch fires selectionChanged', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));

    // Check inside a single evaluate so we can read the log before navigation destroys the context
    const fired = await page.evaluate(() => {
      document.getElementById('languageSwitch').dispatchEvent(new Event('change'));
      return window.__hapticLog.some(function(e) { return e.type === 'selection'; });
    });
    expect(fired).toBe(true);
  });
});

test.describe('HapticFeedback — MainButton tap', () => {
  test('MainButton onClick fires impact(medium) on Bridge page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

    await page.evaluate(() => {
      window.__tgMainButton._handlers.forEach(fn => fn());
    });

    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'impact' && e.style === 'medium')).toBe(true);
  });

  test('MainButton onClick fires impact(medium) on Exchange page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));

    await page.evaluate(() => {
      window.__tgMainButton._handlers.forEach(fn => fn());
    });

    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'impact' && e.style === 'medium')).toBe(true);
  });

  test('MainButton onClick fires impact(medium) on OTC page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));

    await page.evaluate(() => {
      window.__tgMainButton._handlers.forEach(fn => fn());
    });

    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'impact' && e.style === 'medium')).toBe(true);
  });
});

test.describe('HapticFeedback — exchange status events', () => {
  test('Widget finish step fires notificationOccurred(success) on Bridge page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'change-now-widget-step', step: 'finish' },
      }));
    });

    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'notification' && e.notificationType === 'success')).toBe(true);
  });

  test('Widget success step fires notificationOccurred(success) on Exchange page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));

    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'change-now-widget-step', step: 'success' },
      }));
    });

    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'notification' && e.notificationType === 'success')).toBe(true);
  });

  test('Widget error step fires notificationOccurred(error) on Bridge page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'change-now-widget-step', step: 'error' },
      }));
    });

    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'notification' && e.notificationType === 'error')).toBe(true);
  });

  test('Widget failed step fires notificationOccurred(error) on OTC page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));

    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'change-now-widget-step', step: 'failed' },
      }));
    });

    const log = await page.evaluate(() => window.__hapticLog);
    expect(log.some(e => e.type === 'notification' && e.notificationType === 'error')).toBe(true);
  });

  test('No duplicate haptics for repeated same step on Bridge page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

    // Send exchange step 3 times — all from the widget message; each triggers once per message
    await page.evaluate(() => {
      for (var i = 0; i < 3; i++) {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'change-now-widget-step', step: 'finish' },
        }));
      }
    });

    // There should be 3 success notifications (one per message event — no extra internal duplication)
    const log = await page.evaluate(() => window.__hapticLog);
    const successCount = log.filter(e => e.type === 'notification' && e.notificationType === 'success').length;
    expect(successCount).toBe(3);
  });
});
