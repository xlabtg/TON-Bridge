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
    const backButton = {
      _visible: false,
      _handlers: [],
      show() { this._visible = true; },
      hide() { this._visible = false; },
      onClick(fn) { this._handlers.push(fn); },
    };
    window.__tgBackButton = backButton;
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        MainButton: { setText() {}, show() {}, hide() {}, onClick() {} },
        BackButton: backButton,
      },
    };
  });
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

test.describe('/program page — EN', () => {
  test('renders the page heading', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('program.html'));
    const heading = page.locator('.pageTitle');
    await expect(heading).toHaveText('Affiliate Program');
  });

  test('shows rate table with correct service commission', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('program.html'));
    const rows = page.locator('.rate-table tbody tr');
    await expect(rows.first()).toContainText('0.40%');
  });

  test('shows points pills with formula tooltips', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('program.html'));
    const pills = page.locator('.points-pill');
    await expect(pills).toHaveCount(3);
    const firstTooltip = pills.first().locator('.pill-tooltip');
    await expect(firstTooltip).toContainText('333');
  });

  test('tooltip becomes visible on click', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('program.html'));
    const pill = page.locator('.points-pill').first();
    const tooltip = pill.locator('.pill-tooltip');
    await expect(tooltip).toBeHidden();
    await pill.click();
    await expect(tooltip).toBeVisible();
  });

  test('shows worked examples table', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('program.html'));
    const tables = page.locator('.rate-table');
    await expect(tables).toHaveCount(2);
    // Second table is the worked examples — check a $1,000 row exists
    await expect(tables.nth(1)).toContainText('$1');
  });

  test('BackButton is shown on load', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('program.html'));
    const visible = await page.evaluate(() => window.__tgBackButton._visible);
    expect(visible).toBe(true);
  });
});

test.describe('/program page — RU', () => {
  test('renders the Russian page heading', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('program-ru.html'));
    const heading = page.locator('.pageTitle');
    await expect(heading).toHaveText('Партнёрская программа');
  });

  test('shows Russian rate table heading', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('program-ru.html'));
    await expect(page.locator('h4').first()).toHaveText('О программе');
  });

  test('shows points pills on RU page', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('program-ru.html'));
    const pills = page.locator('.points-pill');
    await expect(pills).toHaveCount(3);
  });
});
