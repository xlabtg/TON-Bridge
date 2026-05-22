import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testUrl = 'http://localhost/prefs-test';

async function openPrefsTestPage(page) {
  await page.route(testUrl, route => {
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>prefs test</title>',
    });
  });
  await page.goto(testUrl);
}

// Injects window.prefs from prefs.js — CloudStorage mock must be set up first
async function loadPrefsModule(page, cloudStorageAvailable = true) {
  if (cloudStorageAvailable) {
    await page.addInitScript(() => {
      const store = {};
      window.__csStore = store;
      window.Telegram = {
        WebApp: {
          CloudStorage: {
            setItem(key, value, cb) { store[key] = value; cb && cb(null); },
            getItem(key, cb) { cb && cb(null, store[key] || ''); },
            removeItems(keys, cb) { keys.forEach(k => delete store[k]); cb && cb(null); },
            getKeys(cb) { cb && cb(null, Object.keys(store)); },
          },
        },
      };
    });
  } else {
    await page.addInitScript(() => {
      window.Telegram = undefined;
    });
  }
  await page.addInitScript({ path: resolve(__dirname, '..', 'assets', 'js', 'prefs.js') });
  await openPrefsTestPage(page);
}

async function loadPrefsModuleWithHangingCloudStorage(page) {
  await page.addInitScript(() => {
    localStorage.setItem('pref:lang', 'en');
    window.__prefsCloudStorageTimeoutMs = 50;
    window.Telegram = {
      WebApp: {
        isVersionAtLeast() { return true; },
        CloudStorage: {
          setItem() {},
          getItem() {},
          removeItems() {},
        },
      },
    };
  });
  await page.addInitScript({ path: resolve(__dirname, '..', 'assets', 'js', 'prefs.js') });
  await openPrefsTestPage(page);
}

test.describe('prefs module — CloudStorage available', () => {
  test('set and get a preference via CloudStorage', async ({ page }) => {
    await loadPrefsModule(page, true);

    const result = await page.evaluate(async () => {
      await window.prefs.set('pref:lang', 'ru');
      return {
        value: await window.prefs.get('pref:lang'),
        localValue: localStorage.getItem('pref:lang'),
      };
    });

    expect(result.value).toBe('ru');
    expect(result.localValue).toBeNull();
  });

  test('set null removes the preference', async ({ page }) => {
    await loadPrefsModule(page, true);

    const result = await page.evaluate(async () => {
      await window.prefs.set('pref:theme', 'dark');
      await window.prefs.set('pref:theme', null);
      return await window.prefs.get('pref:theme');
    });

    expect(result).toBeNull();
  });

  test('pref:theme stores and retrieves correctly', async ({ page }) => {
    await loadPrefsModule(page, true);

    const result = await page.evaluate(async () => {
      await window.prefs.set('pref:theme', 'dark');
      return await window.prefs.get('pref:theme');
    });

    expect(result).toBe('dark');
  });

  test('pref:lastFromAmount stores and retrieves a numeric string', async ({ page }) => {
    await loadPrefsModule(page, true);

    const result = await page.evaluate(async () => {
      await window.prefs.set('pref:lastFromAmount', '0.5');
      return await window.prefs.get('pref:lastFromAmount');
    });

    expect(result).toBe('0.5');
  });

  test('migration: copies localStorage pref keys to CloudStorage and clears them', async ({ page }) => {
    // Setup localStorage values and CloudStorage mock BEFORE prefs.js runs
    await page.addInitScript(() => {
      localStorage.setItem('pref:lang', 'en');
      localStorage.setItem('pref:theme', 'light');

      const store = {};
      // Expose store globally so we can inspect it after migration
      window.__csStore = store;
      window.Telegram = {
        WebApp: {
          CloudStorage: {
            setItem(key, value, cb) { store[key] = value; cb && cb(null); },
            getItem(key, cb) { cb && cb(null, store[key] || ''); },
            removeItems(keys, cb) { keys.forEach(k => delete store[k]); cb && cb(null); },
            getKeys(cb) { cb && cb(null, Object.keys(store)); },
          },
        },
      };
    });
    await page.addInitScript({ path: resolve(__dirname, '..', 'assets', 'js', 'prefs.js') });

    await openPrefsTestPage(page);

    // Give migration callbacks time to run
    await page.waitForTimeout(300);

    const { langInCloud, langInLS } = await page.evaluate(() => ({
      langInCloud: window.__csStore['pref:lang'],
      langInLS: localStorage.getItem('pref:lang'),
    }));

    expect(langInCloud).toBe('en');
    // localStorage cleared after migration
    expect(langInLS).toBeNull();
  });

  test('migration runs only once (flag prevents re-migration)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pref:lang', 'ru');

      const store = { 'pref:migrated': '1' }; // Already migrated
      window.__csStore = store;
      window.Telegram = {
        WebApp: {
          CloudStorage: {
            setItem(key, value, cb) { store[key] = value; cb && cb(null); },
            getItem(key, cb) { cb && cb(null, store[key] || ''); },
            removeItems(keys, cb) { keys.forEach(k => delete store[k]); cb && cb(null); },
            getKeys(cb) { cb && cb(null, Object.keys(store)); },
          },
        },
      };
    });
    await page.addInitScript({ path: resolve(__dirname, '..', 'assets', 'js', 'prefs.js') });

    await openPrefsTestPage(page);
    await page.waitForTimeout(300);

    const { langInCloud, langInLS } = await page.evaluate(() => ({
      langInCloud: window.__csStore['pref:lang'],
      langInLS: localStorage.getItem('pref:lang'),
    }));

    // localStorage should NOT have been cleared because migration was already done
    expect(langInLS).toBe('ru');
    // CloudStorage should NOT have been written with old value
    expect(langInCloud).toBeUndefined();
  });

  test('falls back to localStorage when CloudStorage callbacks do not return', async ({ page }) => {
    await loadPrefsModuleWithHangingCloudStorage(page);

    const result = await page.evaluate(async () => {
      await window.prefs.init();
      await window.prefs.set('pref:lang', 'ru');
      return {
        value: await window.prefs.get('pref:lang'),
        localValue: localStorage.getItem('pref:lang'),
      };
    });

    expect(result.value).toBe('ru');
    expect(result.localValue).toBe('ru');
  });
});

test.describe('prefs module — CloudStorage unavailable (fallback)', () => {
  test('falls back to localStorage when CloudStorage is absent', async ({ page }) => {
    await loadPrefsModule(page, false);

    const result = await page.evaluate(async () => {
      await window.prefs.set('pref:lastPair', 'ton→ton-bsc');
      return await window.prefs.get('pref:lastPair');
    });

    expect(result).toBe('ton→ton-bsc');
  });

  test('localStorage fallback: set null removes the key', async ({ page }) => {
    await loadPrefsModule(page, false);

    const result = await page.evaluate(async () => {
      await window.prefs.set('pref:theme', 'dark');
      await window.prefs.set('pref:theme', null);
      return await window.prefs.get('pref:theme');
    });

    expect(result).toBeNull();
  });
});
