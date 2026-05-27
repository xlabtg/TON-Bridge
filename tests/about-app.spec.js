import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock the Telegram WebApp SDK so the settings shell initialises offline.
async function mockTelegramWebApp(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        initDataUnsafe: {},
        MainButton: { setText() {}, show() {}, hide() {}, onClick() {}, offClick() {} },
        SettingsButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      },
    };
  });
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

test.describe('About the app block (issue #168)', () => {
  test('EN: shows marketing copy instead of the credits list', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));

    await expect(page.locator('[data-i18n="settings_about_tagline"]')).toContainText('instant cross');
    await expect(page.locator('[data-i18n="settings_about_feature_chains"]')).toContainText('200+ blockchains and 1200+ coins');
    await expect(page.locator('[data-i18n="settings_about_feature_prices"]')).toContainText('CEX / DEX aggregation');
    await expect(page.locator('[data-i18n="settings_about_feature_security"]')).toContainText('no registration required');
    await expect(page.locator('[data-i18n="settings_about_partners"]')).toContainText('Partners: ChangeNOW');
  });

  test('RU: shows the localized marketing copy', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings-ru.html'));

    await expect(page.locator('[data-i18n="settings_credits_section"]')).toHaveText('О приложении');
    await expect(page.locator('[data-i18n="settings_about_feature_chains"]')).toContainText('блокчейнов');
    await expect(page.locator('[data-i18n="settings_about_partners"]')).toContainText('Партнёры: ChangeNOW');
  });

  test('EN: the third-party credit links and component list are removed', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));

    await expect(page.locator('a[href="/humans.txt"]')).toHaveCount(0);
    await expect(page.locator('a[href*="THIRD_PARTY.md"]')).toHaveCount(0);
    await expect(page.locator('a[href*="themeforest.net"]')).toHaveCount(0);
    await expect(page.locator('a[href*="getbootstrap.com"]')).toHaveCount(0);
    await expect(page.locator('a[href*="apexcharts.com"]')).toHaveCount(0);
    await expect(page.locator('a[href*="splidejs.com"]')).toHaveCount(0);
    await expect(page.locator('a[href*="ionic.io"]')).toHaveCount(0);
  });

  test('EN: the admin panel link is the only link, hidden for non-admins', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));

    const adminLink = page.locator('a[href="admin/index.html"]');
    await expect(adminLink).toHaveCount(1);
    // The link lives inside a data-admin-only span that is hidden by default.
    await expect(adminLink).toBeHidden();
  });

  test('EN: the admin panel link is revealed for an admin user', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.addInitScript(() => {
      window.__adminIds = ['12345'];
      window.__adminUserId = '12345';
    });
    await page.goto(distUrl('app-settings.html'));

    const adminLink = page.locator('a[href="admin/index.html"]');
    await expect(adminLink).toBeVisible();
  });
});
