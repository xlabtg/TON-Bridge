import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distPath(file) {
  return resolve(__dirname, '..', 'dist', file);
}

function distUrl(file) {
  return 'file://' + distPath(file);
}

async function waitForDistFile(file) {
  await expect.poll(() => existsSync(distPath(file)), { timeout: 30000 }).toBe(true);
}

async function mockTelegramWebApp(page, initialTheme, initialColorScheme = 'light') {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript(({ initialTheme, initialColorScheme }) => {
    const eventHandlers = {};
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
        themeParams: { ...initialTheme },
        colorScheme: initialColorScheme,
        ready() {},
        expand() {},
        setHeaderColor() {},
        onEvent(name, handler) {
          eventHandlers[name] = eventHandlers[name] || [];
          eventHandlers[name].push(handler);
        },
        MainButton: mainButton,
        HapticFeedback: {
          impactOccurred() {},
          notificationOccurred() {},
          selectionChanged() {},
        },
      },
    };

    window.__setTelegramTheme = (themeParams, colorScheme) => {
      window.Telegram.WebApp.themeParams = { ...themeParams };
      window.Telegram.WebApp.colorScheme = colorScheme;
      for (const handler of eventHandlers.themeChanged || []) {
        handler();
      }
    };
  }, { initialTheme, initialColorScheme });
}

function iframeParam(page, name) {
  return page.locator('#iframe-widget').evaluate((iframe, name) => {
    return new URL(iframe.src).searchParams.get(name);
  }, name);
}

async function disableIdlePreload(page) {
  await page.addInitScript(() => {
    window.requestIdleCallback = function() { return 0; };
    const origSetTimeout = window.setTimeout;
    window.setTimeout = function(fn, delay, ...args) {
      if (delay === 2000) return 0;
      return origSetTimeout(fn, delay, ...args);
    };
  });
}

test.describe('Telegram themeParams integration', () => {
  test('applies Telegram theme colors to page chrome and ChangeNOW on load', async ({ page }) => {
    await waitForDistFile('index.html');
    await mockTelegramWebApp(page, {
      bg_color: '#123456',
      secondary_bg_color: '#234567',
      text_color: '#fefefe',
      hint_color: '#b0b0b0',
      link_color: '#fedcba',
      button_color: '#abcdef',
      button_text_color: '#010203',
      header_bg_color: '#345678',
      section_bg_color: '#456789',
      section_separator_color: '#56789a',
      bottom_bar_bg_color: '#6789ab',
    }, 'dark');
    await disableIdlePreload(page);

    await page.goto(distUrl('index.html'));

    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(18, 52, 86)');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.appHeader')).backgroundColor))
      .toBe('rgb(52, 86, 120)');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.appBottomMenu')).backgroundColor))
      .toBe('rgb(103, 137, 171)');

    await expect.poll(() => page.evaluate(() => {
      return document.documentElement.style.getPropertyValue('--tg-theme-button-color').trim();
    })).toBe('#abcdef');
    await expect(page.locator('#iframe-widget')).toHaveCount(0);

    await page.locator('#open-exchange-btn').click();
    await expect.poll(() => iframeParam(page, 'primaryColor')).toBe('abcdef');
    await expect.poll(() => iframeParam(page, 'backgroundColor')).toBe('123456');
    await expect.poll(() => iframeParam(page, 'darkMode')).toBe('true');
  });

  test('updates CSS variables and regenerates ChangeNOW src on themeChanged', async ({ page }) => {
    await waitForDistFile('index2.html');
    await mockTelegramWebApp(page, {
      bg_color: '#ffffff',
      text_color: '#000000',
      button_color: '#111111',
      button_text_color: '#ffffff',
    }, 'light');
    await disableIdlePreload(page);

    await page.goto(distUrl('index2.html'));
    await expect(page.locator('#iframe-widget')).toHaveCount(0);
    await page.locator('#open-exchange-btn').click();

    await expect.poll(() => iframeParam(page, 'primaryColor')).toBe('111111');
    await expect.poll(() => iframeParam(page, 'darkMode')).toBe('false');

    await page.evaluate(() => {
      window.__setTelegramTheme({
        bg_color: '#010203',
        text_color: '#f0f1f2',
        button_color: '#a1b2c3',
        button_text_color: '#030201',
        bottom_bar_bg_color: '#040506',
      }, 'dark');
    });

    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(1, 2, 3)');
    await expect.poll(() => iframeParam(page, 'primaryColor')).toBe('a1b2c3');
    await expect.poll(() => iframeParam(page, 'backgroundColor')).toBe('010203');
    await expect.poll(() => iframeParam(page, 'darkMode')).toBe('true');
  });

  test('keeps page chrome and ChangeNOW dark when Telegram omits themeParams', async ({ page }) => {
    await waitForDistFile('index.html');
    await mockTelegramWebApp(page, {}, 'dark');
    await disableIdlePreload(page);

    await page.goto(distUrl('index.html'));

    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(3, 1, 8)');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.appHeader')).backgroundColor))
      .toBe('rgb(22, 17, 41)');

    await expect(page.locator('#iframe-widget')).toHaveCount(0);
    await page.locator('#open-exchange-btn').click();
    await expect.poll(() => iframeParam(page, 'backgroundColor')).toBe('030108');
    await expect.poll(() => iframeParam(page, 'darkMode')).toBe('true');
  });

  test('uses stored local dark mode for ChangeNOW when Telegram is light', async ({ page }) => {
    await waitForDistFile('index2.html');
    await mockTelegramWebApp(page, {
      bg_color: '#ffffff',
      text_color: '#000000',
      button_color: '#111111',
      button_text_color: '#ffffff',
    }, 'light');
    await disableIdlePreload(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('FinappDarkmode', '1');
    });

    await page.goto(distUrl('index2.html'));

    await expect(page.locator('body')).toHaveClass(/\bdark-mode\b/);
    await expect.poll(() => page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--tg-color-scheme').trim();
    })).toBe('dark');

    await expect(page.locator('#iframe-widget')).toHaveCount(0);
    await page.locator('#open-exchange-btn').click();
    await expect.poll(() => iframeParam(page, 'backgroundColor')).toBe('030108');
    await expect.poll(() => iframeParam(page, 'darkMode')).toBe('true');
  });
});
