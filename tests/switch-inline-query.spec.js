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
    window.__switchInlineQueryCalls = [];
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
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        MainButton: mainButton,
        switchInlineQuery(query, types) {
          window.__switchInlineQueryCalls.push({ query, types });
        },
      },
    };
  });
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

test.describe('"Send to chat" button — switchInlineQuery', () => {
  test('Bridge EN: button is present with text "Send to chat"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const btn = page.locator('#send-to-chat-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Send to chat');
  });

  test('Bridge RU: button is present with text "Отправить в чат"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index-ru.html'));
    const btn = page.locator('#send-to-chat-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Отправить в чат');
  });

  test('Exchange EN: button is present with text "Send to chat"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));
    const btn = page.locator('#send-to-chat-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Send to chat');
  });

  test('OTC EN: button is present with text "Send to chat"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));
    const btn = page.locator('#send-to-chat-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Send to chat');
  });

  test('Bridge EN: clicking button calls switchInlineQuery with "bridge ton 10"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await page.locator('#send-to-chat-btn').click();
    const calls = await page.evaluate(() => window.__switchInlineQueryCalls);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].query).toBe('bridge ton 10');
  });

  test('Exchange EN: clicking button calls switchInlineQuery with "bridge btc ton 0.1"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));
    await page.locator('#send-to-chat-btn').click();
    const calls = await page.evaluate(() => window.__switchInlineQueryCalls);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].query).toBe('bridge btc ton 0.1');
  });

  test('OTC EN: clicking button calls switchInlineQuery with "bridge usdtton ton 1000000"', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index3.html'));
    await page.locator('#send-to-chat-btn').click();
    const calls = await page.evaluate(() => window.__switchInlineQueryCalls);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].query).toBe('bridge usdtton ton 1000000');
  });

  test('switchInlineQuery is called with chat_types array', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await page.locator('#send-to-chat-btn').click();
    const calls = await page.evaluate(() => window.__switchInlineQueryCalls);
    expect(calls.length).toBeGreaterThan(0);
    expect(Array.isArray(calls[0].types)).toBe(true);
    expect(calls[0].types).toContain('users');
    expect(calls[0].types).toContain('groups');
    expect(calls[0].types).toContain('channels');
  });

  test('sendToChat is a no-op when switchInlineQuery is unavailable', async ({ page }) => {
    await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* mocked */',
    }));

    await page.addInitScript(() => {
      const mainButton = {
        _text: '', _visible: false, _handlers: [],
        setText(text) { this._text = text; },
        show() { this._visible = true; },
        hide() { this._visible = false; },
        onClick(fn) { this._handlers.push(fn); },
        offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
      };
      window.Telegram = {
        WebApp: {
          ready() {},
          expand() {},
          onEvent() {},
          setHeaderColor() {},
          colorScheme: 'light',
          MainButton: mainButton,
          // switchInlineQuery intentionally absent to test fallback
        },
      };
    });

    await page.goto(distUrl('index.html'));
    // Should not throw
    await expect(page.locator('#send-to-chat-btn').click()).resolves.toBeUndefined();
  });
});
