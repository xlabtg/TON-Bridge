import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

async function setStoredLang(page, lang) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('pref:lang', value);
  }, lang);
}

// Alphabet used by referral.js (mirrors the constant in the module)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

async function mockTelegramWebApp(page, { cloudStorage = {}, initData = '' } = {}) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' })
  );

  await page.addInitScript(({ initialStorage, initDataValue }) => {
    const store = Object.assign({}, initialStorage);
    const backButton = {
      _visible: false,
      _handlers: [],
      show() { this._visible = true; },
      hide() { this._visible = false; },
      onClick(fn) { this._handlers.push(fn); },
      offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
    };
    const mainButton = {
      _text: '',
      _visible: false,
      _handlers: [],
      setText(t) { this._text = t; },
      show() { this._visible = true; },
      hide() { this._visible = false; },
      onClick(fn) { this._handlers.push(fn); },
      offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
    };
    const cloudStorage = {
      _store: store,
      getItem(key, cb) {
        const v = this._store[key];
        cb(v === undefined ? 'not found' : null, v || '');
      },
      setItem(key, value, cb) {
        this._store[key] = value;
        cb(null);
      },
    };
    window.__tgCloudStorage = cloudStorage;
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        initData: initDataValue,
        BackButton: backButton,
        MainButton: mainButton,
        CloudStorage: cloudStorage,
        HapticFeedback: {
          notificationOccurred() {},
        },
        openTelegramLink(url) {
          window.__lastTelegramLink = url;
        },
      },
    };
  }, { initialStorage: cloudStorage, initDataValue: initData });
}

test.describe('ReferralModule — unit-level (pure logic)', () => {
  test('generateCode returns 8 chars from the allowed alphabet', async ({ page }) => {
    await page.route('**/*', route => route.continue());
    await page.addInitScript(() => { window.__referralI18n = {}; });
    await page.goto('about:blank');
    await page.addScriptTag({ path: resolve(__dirname, '..', 'assets/js/referral.js') });

    const result = await page.evaluate(() => {
      const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      const code = window.ReferralModule.generateCode();
      const valid = code.length === 8 && [...code].every(c => ALPHABET.includes(c));
      return { code, valid };
    });

    expect(result.valid, `code "${result.code}" should be 8 chars from the alphabet`).toBe(true);
  });

  test('generateCode never contains ambiguous chars (0,O,1,I,L)', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: resolve(__dirname, '..', 'assets/js/referral.js') });

    const allClean = await page.evaluate(() => {
      const BANNED = /[01OIL]/;
      for (let i = 0; i < 200; i++) {
        if (BANNED.test(window.ReferralModule.generateCode())) return false;
      }
      return true;
    });

    expect(allClean).toBe(true);
  });

  test('shareUrl produces the correct deep-link format', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: resolve(__dirname, '..', 'assets/js/referral.js') });

    const url = await page.evaluate(() =>
      window.ReferralModule.shareUrl('ABCD1234')
    );

    expect(url).toBe('https://t.me/TONBridge_robot/app?startapp=ref_ABCD1234');
  });
});

test.describe('ReferralModule — integration (settings page)', () => {
  test('Settings EN: referral section title is visible', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    await expect(page.locator('.listview-title', { hasText: 'Invite Friends' })).toBeVisible();
  });

  test('Settings RU: referral section title is in Russian', async ({ page }) => {
    await mockTelegramWebApp(page);
    await setStoredLang(page, 'ru');
    await page.goto(distUrl('app-settings.html'));
    await expect(page.locator('.listview-title', { hasText: 'Пригласить друзей' })).toBeVisible();
  });

  test('Settings EN: referral-section div is rendered with code and share button', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));

    // The referral-section is populated by JS; wait for the share button to appear.
    await expect(page.locator('#ref-share-btn')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#ref-copy-btn')).toBeVisible();
  });

  test('Settings: generated code is 8 chars from the correct alphabet', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));

    await page.waitForSelector('#ref-code-display', { timeout: 5000 });
    const code = await page.locator('#ref-code-display').innerText();

    const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    expect(code).toHaveLength(8);
    for (const ch of code) {
      expect(ALPHABET).toContain(ch);
    }
  });

  test('Settings: code is persisted in CloudStorage and re-used on reload', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    await page.waitForSelector('#ref-code-display', { timeout: 5000 });

    const code1 = await page.locator('#ref-code-display').innerText();
    const stored = await page.evaluate(() => window.__tgCloudStorage._store['ref_code']);
    expect(stored).toBe(code1);

    // Reload with the stored code pre-seeded — simulates a returning user.
    await mockTelegramWebApp(page, { cloudStorage: { ref_code: code1 } });
    await page.goto(distUrl('app-settings.html'));
    await page.waitForSelector('#ref-code-display', { timeout: 5000 });

    const code2 = await page.locator('#ref-code-display').innerText();
    expect(code2).toBe(code1);
  });

  test('Settings: uses server-issued ref_code from auth verify response', async ({ page }) => {
    await page.route('**/auth/verify', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'header.payload.sig',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: 42,
            username: 'alice',
            language_code: 'en',
            ref_code: 'ZXCV2345',
            ref_share_url: 'https://t.me/TONBridge_robot/app?startapp=ref_ZXCV2345',
          },
        }),
      }),
    );
    await mockTelegramWebApp(page, { initData: 'query_id=AAA&auth_date=9999999999&hash=abc' });
    await page.goto(distUrl('app-settings.html'));

    await expect(page.locator('#ref-code-display')).toHaveText('ZXCV2345', { timeout: 5000 });
    const stored = await page.evaluate(() => window.__tgCloudStorage._store['ref_code']);
    expect(stored).toBeUndefined();
  });

  test('Settings: verifies initData against the deployed worker before rendering referral code', async ({ page }) => {
    let authCalled = false;
    await page.route('https://ton-bridge-worker.tonbankcard.workers.dev/auth/verify', route => {
      authCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'header.payload.sig',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: 42,
            username: 'alice',
            language_code: 'en',
            ref_code: 'SERVER42',
            ref_share_url: 'https://t.me/TONBridge_robot/app?startapp=ref_SERVER42',
          },
        }),
      });
    });
    await mockTelegramWebApp(page, { initData: 'query_id=AAA&auth_date=9999999999&hash=abc' });
    await page.goto(distUrl('app-settings.html'));

    await expect(page.locator('#ref-code-display')).toHaveText('SERVER42', { timeout: 5000 });
    expect(authCalled).toBe(true);
  });

  test('Settings: share button calls openTelegramLink with share URL', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    await page.waitForSelector('#ref-share-btn', { timeout: 5000 });

    await page.locator('#ref-share-btn').click();

    const link = await page.evaluate(() => window.__lastTelegramLink);
    expect(link).toMatch(/^https:\/\/t\.me\/share\/url\?url=/);
    expect(link).toContain('TONBridge_robot');
    expect(link).toContain('ref_');
  });

  test('Settings: copy button shows copied confirmation message', async ({ page }) => {
    await mockTelegramWebApp(page);
    // Grant clipboard permission so navigator.clipboard.writeText resolves.
    await page.context().grantPermissions(['clipboard-write']);

    await page.goto(distUrl('app-settings.html'));
    await page.waitForSelector('#ref-copy-btn', { timeout: 5000 });

    // Confirm message is initially hidden
    const msgBefore = await page.locator('#ref-copied-msg').isVisible();
    expect(msgBefore).toBe(false);

    await page.locator('#ref-copy-btn').click();

    // Message should appear briefly after the async clipboard write resolves.
    await expect(page.locator('#ref-copied-msg')).toBeVisible({ timeout: 3000 });
  });

  test('Screenshot: Settings EN — referral section visible', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    await page.waitForSelector('#ref-share-btn', { timeout: 5000 });
    await page.screenshot({ path: 'tests/screenshots/settings-referral-en.png', fullPage: true });
  });
});
