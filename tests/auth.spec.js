/**
 * Tests for the auth.js initData verification helper.
 *
 * The Telegram SDK is mocked so tests run outside a real Telegram client.
 * The worker endpoint is intercepted so no real network call is made.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared setup helpers
// ──────────────────────────────────────────────────────────────────────────────

async function mockTelegramWithInitData(page, initData) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' }),
  );

  await page.addInitScript((initDataValue) => {
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        initData: initDataValue,
        MainButton: {
          _text: '',
          _visible: false,
          _handlers: [],
          setText(t) { this._text = t; },
          show() { this._visible = true; },
          hide() { this._visible = false; },
          onClick(fn) { this._handlers.push(fn); },
          offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
        },
      },
    };
  }, initData);
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

test.describe('auth.js — TonBridgeAuth helper', () => {
  test('exposes getToken() and getUser() on window.TonBridgeAuth', async ({ page }) => {
    await mockTelegramWithInitData(page, '');
    await page.goto(distUrl('index.html'));

    const hasMethods = await page.evaluate(() =>
      typeof window.TonBridgeAuth === 'object' &&
      typeof window.TonBridgeAuth.getToken === 'function' &&
      typeof window.TonBridgeAuth.getUser === 'function' &&
      typeof window.TonBridgeAuth.verify === 'function',
    );
    expect(hasMethods).toBe(true);
  });

  test('getToken() returns null when initData is empty (outside Telegram)', async ({ page }) => {
    await mockTelegramWithInitData(page, '');
    await page.goto(distUrl('index.html'));

    const token = await page.evaluate(() => window.TonBridgeAuth.getToken());
    expect(token).toBeNull();
  });

  test('caches JWT in memory after a successful verify response', async ({ page }) => {
    const fakeToken = 'header.payload.sig';
    const fakeExpiresAt = Math.floor(Date.now() / 1000) + 3600;

    // Intercept any fetch to the worker URL
    await page.route('**/auth/verify', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: fakeToken,
          expiresAt: fakeExpiresAt,
          user: { id: 99, username: 'bob', language_code: 'en' },
        }),
      }),
    );

    await mockTelegramWithInitData(page, 'query_id=AAA&auth_date=9999999999&hash=abc');
    await page.goto(distUrl('index.html'));

    // Wait for the in-flight verify() promise to settle
    await page.waitForFunction(() => window.TonBridgeAuth.getToken() !== null, { timeout: 5000 });

    const token = await page.evaluate(() => window.TonBridgeAuth.getToken());
    expect(token).toBe(fakeToken);

    const user = await page.evaluate(() => window.TonBridgeAuth.getUser());
    expect(user).toEqual({ id: 99, username: 'bob', language_code: 'en' });
  });

  test('getToken() returns null after a 401 from the worker', async ({ page }) => {
    await page.route('**/auth/verify', route =>
      route.fulfill({ status: 401 }),
    );

    await mockTelegramWithInitData(page, 'query_id=AAA&auth_date=9999999999&hash=bad');
    await page.goto(distUrl('index.html'));

    // Give auth.js time to settle
    await page.waitForTimeout(500);

    const token = await page.evaluate(() => window.TonBridgeAuth.getToken());
    expect(token).toBeNull();
  });

  test('getToken() returns null when the token is expired', async ({ page }) => {
    const expiredAt = Math.floor(Date.now() / 1000) - 1; // already expired

    await page.route('**/auth/verify', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'expired.token.sig',
          expiresAt: expiredAt,
          user: { id: 1 },
        }),
      }),
    );

    await mockTelegramWithInitData(page, 'query_id=AAA&auth_date=9999999999&hash=abc');
    await page.goto(distUrl('index.html'));

    await page.waitForTimeout(500);

    const token = await page.evaluate(() => window.TonBridgeAuth.getToken());
    expect(token).toBeNull();
  });
});
