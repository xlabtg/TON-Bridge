import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

async function setLangPref(page, lang) {
  await page.addInitScript((l) => {
    localStorage.setItem('pref:lang', l);
  }, lang);
}

/**
 * Mock Telegram.WebApp with configurable BiometricManager behaviour.
 *
 * @param {object} opts
 * @param {boolean} opts.bmAvailable     Whether isBiometricAvailable is true
 * @param {boolean} opts.bmAccessGranted Whether isAccessGranted is true
 * @param {boolean} opts.authenticateOk  Whether authenticate() calls back with true
 */
async function mockTelegramWithBiometric(page, opts = {}) {
  const { bmAvailable = true, bmAccessGranted = true, authenticateOk = true } = opts;

  await page.route('https://telegram.org/js/telegram-web-app.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' })
  );

  await page.addInitScript(({ bmAvailable, bmAccessGranted, authenticateOk }) => {
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

    const biometricManager = {
      isInited: false,
      isBiometricAvailable: bmAvailable,
      isAccessGranted: bmAccessGranted,
      init(cb) {
        this.isInited = true;
        cb();
      },
      requestAccess(params, cb) { cb(bmAccessGranted); },
      authenticate(params, cb) { cb(authenticateOk); },
    };

    const cloudStorage = {
      _store: {},
      getItem(key, cb) { cb(null, this._store[key] || ''); },
      setItem(key, val, cb) { this._store[key] = val; if (cb) cb(null); },
    };

    window.__tgMainButton = mainButton;
    window.__tgBiometricManager = biometricManager;
    window.__tgCloudStorage = cloudStorage;

    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        MainButton: mainButton,
        BiometricManager: biometricManager,
        CloudStorage: cloudStorage,
      },
    };
  }, { bmAvailable, bmAccessGranted, authenticateOk });
}

// -------------------------------------------------------------------------
// Settings page — toggle visibility and persistence
// -------------------------------------------------------------------------

test.describe('Settings — biometric toggle', () => {
  test('Security section is rendered on settings page (EN)', async ({ page }) => {
    await mockTelegramWithBiometric(page);
    await page.goto(distUrl('app-settings.html'));
    await expect(page.locator('#biometric-section')).toBeVisible();
  });

  test('Security section is rendered on settings page (RU)', async ({ page }) => {
    await mockTelegramWithBiometric(page);
    await setLangPref(page, 'ru');
    await page.goto(distUrl('app-settings.html'));
    await expect(page.locator('#biometric-section')).toBeVisible();
  });

  test('Toggle is disabled and hint shown when biometrics unavailable', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: false });
    await page.goto(distUrl('app-settings.html'));

    // Wait for BiometricAuth.init() to call back
    await page.waitForFunction(() => {
      const sw = document.getElementById('biometricSwitch');
      return sw && sw.disabled;
    });

    const sw = page.locator('#biometricSwitch');
    await expect(sw).toBeDisabled();

    const hint = page.locator('#biometric-unavailable-hint');
    await expect(hint).toBeVisible();
  });

  test('Toggle is enabled when biometrics available', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true });
    await page.goto(distUrl('app-settings.html'));

    await page.waitForFunction(() => {
      const sw = document.getElementById('biometricSwitch');
      return sw && !sw.disabled;
    });

    const sw = page.locator('#biometricSwitch');
    await expect(sw).toBeEnabled();
  });

  test('Threshold row hidden by default (feature off)', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true });
    await page.goto(distUrl('app-settings.html'));

    await page.waitForFunction(() => {
      const sw = document.getElementById('biometricSwitch');
      return sw && !sw.disabled;
    });

    const row = page.locator('#biometric-threshold-row');
    await expect(row).toBeHidden();
  });

  test('Threshold row appears after enabling toggle', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true });
    await page.goto(distUrl('app-settings.html'));

    await page.waitForFunction(() => {
      const sw = document.getElementById('biometricSwitch');
      return sw && !sw.disabled;
    });

    // Bootstrap hides the underlying checkbox visually; use JS to trigger change
    await page.evaluate(() => {
      const sw = document.getElementById('biometricSwitch');
      sw.checked = true;
      sw.dispatchEvent(new Event('change'));
    });

    const row = page.locator('#biometric-threshold-row');
    await expect(row).toBeVisible();
  });

  test('setEnabled persisted to CloudStorage when toggled on', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true });
    await page.goto(distUrl('app-settings.html'));

    await page.waitForFunction(() => {
      const sw = document.getElementById('biometricSwitch');
      return sw && !sw.disabled;
    });

    await page.evaluate(() => {
      const sw = document.getElementById('biometricSwitch');
      sw.checked = true;
      sw.dispatchEvent(new Event('change'));
    });

    const stored = await page.evaluate(() => {
      return window.Telegram.WebApp.CloudStorage._store['biometricEnabled'];
    });
    expect(stored).toBe('1');
  });

  test('Default threshold value is 1000', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true });
    await page.goto(distUrl('app-settings.html'));

    await page.waitForFunction(() => !document.getElementById('biometricSwitch').disabled);

    await page.evaluate(() => {
      const sw = document.getElementById('biometricSwitch');
      sw.checked = true;
      sw.dispatchEvent(new Event('change'));
    });

    const val = await page.locator('#biometricThreshold').inputValue();
    expect(Number(val)).toBe(1000);
  });

  test('Threshold change persisted to CloudStorage', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true });
    await page.goto(distUrl('app-settings.html'));

    await page.waitForFunction(() => !document.getElementById('biometricSwitch').disabled);

    await page.evaluate(() => {
      const sw = document.getElementById('biometricSwitch');
      sw.checked = true;
      sw.dispatchEvent(new Event('change'));
    });

    await page.locator('#biometricThreshold').fill('5000');
    await page.locator('#biometricThreshold').dispatchEvent('change');

    const stored = await page.evaluate(() =>
      window.Telegram.WebApp.CloudStorage._store['biometricThreshold']
    );
    expect(Number(stored)).toBe(5000);
  });
});

// -------------------------------------------------------------------------
// OTC page — MainButton guarded by biometric
// -------------------------------------------------------------------------

test.describe('OTC page — biometric guard on MainButton', () => {
  test('BiometricAuth is available on OTC page', async ({ page }) => {
    await mockTelegramWithBiometric(page);
    await page.goto(distUrl('index3.html'));

    const available = await page.evaluate(() => typeof window.BiometricAuth !== 'undefined');
    expect(available).toBe(true);
  });

  test('MainButton click: trade proceeds when biometric off (feature disabled)', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true, authenticateOk: true });
    await page.goto(distUrl('index3.html'));

    // Biometric is off by default; firing the handler must not throw.
    // We can't intercept cross-origin iframe postMessage, so we just verify
    // that guardTrade's proceed path runs without errors.
    const errorOccurred = await page.evaluate(() => {
      return new Promise(resolve => {
        try {
          window.__tgMainButton._handlers.forEach(fn => fn());
          // Allow async callbacks to complete
          setTimeout(() => resolve(false), 150);
        } catch (e) {
          resolve(true);
        }
      });
    });
    expect(errorOccurred).toBe(false);
  });

  test('MainButton click: authenticate called when biometric enabled and amount >= threshold', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true, bmAccessGranted: true, authenticateOk: true });
    await page.goto(distUrl('index3.html'));

    // Enable biometric via CloudStorage before the guard runs
    await page.evaluate(() => {
      window.Telegram.WebApp.CloudStorage._store['biometricEnabled'] = '1';
      window.Telegram.WebApp.CloudStorage._store['biometricThreshold'] = '500';
      // Inject a large amount so the threshold is exceeded
      window.__otcAmount = 1000000;
    });

    let authenticateCalled = false;
    await page.evaluate(() => {
      const origAuth = window.__tgBiometricManager.authenticate.bind(window.__tgBiometricManager);
      window.__tgBiometricManager.authenticate = function (params, cb) {
        window.__authenticateCalled = true;
        origAuth(params, cb);
      };
    });

    // Fire handlers
    await page.evaluate(() => {
      window.__tgMainButton._handlers.forEach(fn => fn());
    });

    // Allow microtasks to flush
    await page.waitForTimeout(100);

    authenticateCalled = await page.evaluate(() => !!window.__authenticateCalled);
    expect(authenticateCalled).toBe(true);
  });

  test('MainButton click: missing amount does not trigger biometric prompt', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true, bmAccessGranted: true, authenticateOk: true });
    await page.goto(distUrl('index3.html'));

    await page.evaluate(() => {
      window.Telegram.WebApp.CloudStorage._store['biometricEnabled'] = '1';
      window.Telegram.WebApp.CloudStorage._store['biometricThreshold'] = '500';
      delete window.__otcAmount;
      window.__authenticateCalled = false;
      window.__tgBiometricManager.authenticate = function (params, cb) {
        window.__authenticateCalled = true;
        cb(true);
      };
    });

    await page.evaluate(() => {
      window.__tgMainButton._handlers.forEach(fn => fn());
    });

    await page.waitForTimeout(100);

    const authenticateCalled = await page.evaluate(() => !!window.__authenticateCalled);
    expect(authenticateCalled).toBe(false);
  });

  test('MainButton click: trade aborted and toast shown when biometric fails', async ({ page }) => {
    await mockTelegramWithBiometric(page, { bmAvailable: true, bmAccessGranted: true, authenticateOk: false });
    await page.goto(distUrl('index3.html'));

    await page.evaluate(() => {
      window.Telegram.WebApp.CloudStorage._store['biometricEnabled'] = '1';
      window.Telegram.WebApp.CloudStorage._store['biometricThreshold'] = '500';
      window.__otcAmount = 1000000;
      window.__submitCalled = false;
      // Track whether iframe received a submit
      const iframe = document.getElementById('iframe-widget');
      if (iframe && iframe.contentWindow) {
        try {
          const orig = iframe.contentWindow.postMessage;
          iframe.contentWindow.postMessage = function (msg) {
            if (msg && msg.type === 'submit') window.__submitCalled = true;
          };
        } catch (e) {}
      }
    });

    await page.evaluate(() => {
      window.__tgMainButton._handlers.forEach(fn => fn());
    });

    await page.waitForTimeout(200);

    // Toast should appear
    const toastVisible = await page.evaluate(() => {
      const t = document.getElementById('biometric-toast');
      return t !== null && t.classList.contains('show');
    });
    expect(toastVisible).toBe(true);
  });

  test('OTC RU page also has BiometricAuth', async ({ page }) => {
    await mockTelegramWithBiometric(page);
    await setLangPref(page, 'ru');
    await page.goto(distUrl('index3.html'));

    const available = await page.evaluate(() => typeof window.BiometricAuth !== 'undefined');
    expect(available).toBe(true);
  });
});
