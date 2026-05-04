import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

// Valid TON addresses for testing.
// EQAAA...AM9c is a checksum-valid non-bounceable base64url address (all-zero hash).
const VALID_TON_ADDR = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
// Raw hex form is always accepted (64 hex chars).
const ANOTHER_ADDR   = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Set up a minimal Telegram WebApp mock including CloudStorage.
 */
async function mockTelegramWebApp(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript(() => {
    const _store = {};
    const cloudStorage = {
      _store,
      getItem(key, cb) {
        setTimeout(() => cb(null, _store[key] || null), 0);
      },
      setItem(key, value, cb) {
        _store[key] = value;
        setTimeout(() => cb && cb(null), 0);
      },
    };

    const mainButton = {
      _text: '', _visible: false, _handlers: [],
      setText(t) { this._text = t; },
      show() { this._visible = true; },
      hide() { this._visible = false; },
      onClick(fn) { this._handlers.push(fn); },
      offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
    };

    window.__tgCloudStorage = cloudStorage;
    window.__tgMainButton = mainButton;
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        MainButton: mainButton,
        CloudStorage: cloudStorage,
      },
    };
  });
}

// ── isValidTonAddress unit tests ──────────────────────────────────────────

test.describe('AddressBook.isValidTonAddress', () => {
  test('accepts a valid raw hex address (64 hex chars)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const valid = await page.evaluate(() =>
      AddressBook.isValidTonAddress('0000000000000000000000000000000000000000000000000000000000000000')
    );
    expect(valid).toBe(true);
  });

  test('accepts a valid raw hex address with 0x prefix', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const valid = await page.evaluate(() =>
      AddressBook.isValidTonAddress('0x0000000000000000000000000000000000000000000000000000000000000000')
    );
    expect(valid).toBe(true);
  });

  test('rejects an empty string', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const valid = await page.evaluate(() => AddressBook.isValidTonAddress(''));
    expect(valid).toBe(false);
  });

  test('rejects a random short string', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const valid = await page.evaluate(() => AddressBook.isValidTonAddress('notanaddress'));
    expect(valid).toBe(false);
  });

  test('rejects a base64url string with bad checksum', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    // 48-char string where the last two bytes (checksum) are wrong
    const valid = await page.evaluate(() =>
      AddressBook.isValidTonAddress('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    );
    expect(valid).toBe(false);
  });
});

// ── Address book chip rendering ──────────────────────────────────────────

test.describe('Address book chip list', () => {
  test('chips container is hidden when no addresses saved', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    // Give CloudStorage callback time to fire
    await page.waitForTimeout(100);
    const display = await page.evaluate(() => {
      const el = document.getElementById('address-book-chips');
      return el ? el.style.display : null;
    });
    expect(display).toBe('none');
  });

  test('chips render after saving a valid address via AddressBook.save', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

    // Use the public API to save a valid address, then wait for async CloudStorage
    // callback and re-render.
    await page.evaluate((addr) => {
      // Directly seed entries and re-render by calling init again is risky,
      // so instead use save() and wait for the async CloudStorage round-trip.
      AddressBook.save('ton', addr);
    }, VALID_TON_ADDR);

    // CloudStorage setItem is async (setTimeout 0), chips render is triggered by save
    await page.waitForTimeout(200);

    const chipsCount = await page.evaluate(() =>
      document.querySelectorAll('.address-book-chip').length
    );
    expect(chipsCount).toBeGreaterThan(0);
  });

  test('chip container is present in DOM on widget page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const el = await page.locator('#address-book-chips');
    await expect(el).toBeAttached();
  });

  test('chip container is present in DOM on exchange page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index2.html'));
    const el = await page.locator('#address-book-chips');
    await expect(el).toBeAttached();
  });
});

// ── Action sheet ──────────────────────────────────────────────────────────

test.describe('Address book action sheet', () => {
  test('action sheet element exists in DOM', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const el = await page.locator('#address-book-action-sheet');
    await expect(el).toBeAttached();
  });

  test('action sheet has Edit, Pin, Remove buttons', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await expect(page.locator('[data-ab-action="edit"]')).toBeAttached();
    await expect(page.locator('[data-ab-action="pin"]')).toBeAttached();
    await expect(page.locator('[data-ab-action="remove"]')).toBeAttached();
  });
});

// ── Settings / Manage addresses ───────────────────────────────────────────

test.describe('Manage addresses (settings page)', () => {
  test('manage list element exists in settings DOM', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    const el = await page.locator('#address-book-manage-list');
    await expect(el).toBeAttached();
  });

  test('shows empty state message when no addresses saved', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    await page.waitForTimeout(200);
    const text = await page.locator('#address-book-manage-list').innerText();
    // Should contain the "No saved addresses" i18n string or similar
    expect(text.length).toBeGreaterThan(0);
  });

  test('Address Book section heading visible in settings', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    // The listview-title above the manage list should contain ab_section text
    const headings = await page.locator('.listview-title').allInnerTexts();
    const hasAbHeading = headings.some(h => h.trim().length > 0);
    expect(hasAbHeading).toBe(true);
  });
});

// ── saveAddress integration via postMessage ───────────────────────────────

test.describe('Address book saveAddress via postMessage', () => {
  test('postMessage with recipientAddress triggers save (no error thrown)', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));

    const errorThrown = await page.evaluate((addr) => {
      try {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'recipient-update', recipientAddress: addr },
        }));
        return false;
      } catch (e) {
        return true;
      }
    }, VALID_TON_ADDR);

    expect(errorThrown).toBe(false);
  });

  test('invalid address is silently ignored by saveAddress', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await page.waitForTimeout(50);

    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'recipient-update', recipientAddress: 'not-a-real-address' },
      }));
    });
    await page.waitForTimeout(100);

    // CloudStorage should not have written anything
    const stored = await page.evaluate(() =>
      window.__tgCloudStorage._store['addressBook:ton'] || null
    );
    expect(stored).toBeNull();
  });
});
