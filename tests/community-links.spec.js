import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUPPORT_LINK = 'https://t.me/tonbankcard_bot';

const locales = {
  en: JSON.parse(readFileSync(resolve(__dirname, '..', 'src', 'i18n', 'en.json'), 'utf8')),
  ru: JSON.parse(readFileSync(resolve(__dirname, '..', 'src', 'i18n', 'ru.json'), 'utf8')),
};

function distPath(file) {
  return resolve(__dirname, '..', 'dist', file);
}

function distUrl(file) {
  return 'file://' + distPath(file);
}

async function waitForDistFile(file) {
  await expect.poll(() => existsSync(distPath(file)), { timeout: 30000 }).toBe(true);
}

async function mockTelegramWebApp(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript(() => {
    window.__openedTelegramLinks = [];
    window.Telegram = {
      WebApp: {
        initData: '',
        initDataUnsafe: {},
        themeParams: {},
        colorScheme: 'light',
        ready() {},
        expand() {},
        setHeaderColor() {},
        onEvent() {},
        openTelegramLink(url) {
          window.__openedTelegramLinks.push(url);
        },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
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
        HapticFeedback: {
          notificationOccurred() {},
          impactOccurred() {},
          selectionChanged() {},
        },
        CloudStorage: {
          setItem(_key, _value, callback) { if (callback) callback(null); },
          getItem(_key, callback) { if (callback) callback(null, null); },
        },
      },
    };
  });
}

const PAGES = [
  ['Bridge EN', 'index.html', 'en'],
  ['Bridge RU', 'index-ru.html', 'ru'],
  ['Exchange EN', 'index2.html', 'en'],
  ['Exchange RU', 'index2-ru.html', 'ru'],
  ['OTC EN', 'index3.html', 'en'],
  ['OTC RU', 'index3-ru.html', 'ru'],
  ['Statistics EN', 'index4.html', 'en'],
  ['Statistics RU', 'index4-ru.html', 'ru'],
  ['Referral EN', 'referral.html', 'en'],
  ['Referral RU', 'referral-ru.html', 'ru'],
  ['Settings EN', 'app-settings.html', 'en'],
  ['Settings RU', 'app-settings-ru.html', 'ru'],
];

test.describe('Telegram community links', () => {
  for (const [label, file, locale] of PAGES) {
    test(`${label}: sidebar links keep browser fallback and Telegram handoff`, async ({ page }) => {
      await waitForDistFile(file);
      await mockTelegramWebApp(page);
      await page.goto(distUrl(file));

      const expected = locales[locale];
      const supportLink = page.locator('#support-link');
      const groupLink = page.locator('#community-group-link');
      const chatLink = page.locator('#community-chat-link');

      await expect(supportLink).toHaveAttribute('href', SUPPORT_LINK);
      await expect(groupLink).toHaveAttribute('href', expected.community_group_link);
      await expect(chatLink).toHaveAttribute('href', expected.community_chat_link);

      for (const link of [supportLink, groupLink, chatLink]) {
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', /noopener/);
        await expect(link).not.toHaveAttribute('href', /javascript:/);
      }

      await groupLink.dispatchEvent('click', { bubbles: true, cancelable: true });
      await expect.poll(() => page.evaluate(() => window.__openedTelegramLinks))
        .toContain(expected.community_group_link);
    });
  }
});
