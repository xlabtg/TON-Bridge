import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

/**
 * Set up a mock Telegram.WebApp with a given user ID and an allowed admin IDs list.
 * adminIds: null means empty allow-list (nobody is admin), otherwise an array of string IDs.
 */
async function mockTelegramAdmin(page, userId, adminIds) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript(({ uid, ids }) => {
    // Inject allowed IDs before admin.js runs (admin.js checks window.__adminIds).
    window.__adminIds = ids || [];

    const backButton = {
      _visible: false,
      _handlers: [],
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
        initDataUnsafe: uid ? { user: { id: Number(uid) } } : {},
        BackButton: backButton,
      },
    };
  }, { uid: userId || null, ids: adminIds });
}

test.describe('Admin page — access control', () => {
  test('shows 403 when allow-list is empty', async ({ page }) => {
    await mockTelegramAdmin(page, '99999', []);
    await page.goto(distUrl('admin/index.html'));
    await expect(page.locator('#access-denied')).toBeVisible();
    await expect(page.locator('#admin-content')).toBeHidden();
  });

  test('shows 403 when user ID is not in the allow-list', async ({ page }) => {
    await mockTelegramAdmin(page, '99999', ['12345', '67890']);
    await page.goto(distUrl('admin/index.html'));
    await expect(page.locator('#access-denied')).toBeVisible();
    await expect(page.locator('#admin-content')).toBeHidden();
  });

  test('shows admin content when user ID matches allow-list', async ({ page }) => {
    await mockTelegramAdmin(page, '12345', ['12345', '67890']);
    await page.goto(distUrl('admin/index.html'));
    await expect(page.locator('#admin-content')).toBeVisible();
    await expect(page.locator('#access-denied')).toBeHidden();
  });
});

test.describe('Admin page — stats rendering', () => {
  async function loadAdminAsAdmin(page) {
    await mockTelegramAdmin(page, '12345', ['12345']);
    await page.goto(distUrl('admin/index.html'));
    await expect(page.locator('#admin-content')).toBeVisible();
  }

  test('renders turnover stats with dollar signs', async ({ page }) => {
    await loadAdminAsAdmin(page);
    const h24 = await page.locator('#stat-turnover-24h').textContent();
    expect(h24).toMatch(/\$/);
    const d7 = await page.locator('#stat-turnover-7d').textContent();
    expect(d7).toMatch(/\$/);
    const d30 = await page.locator('#stat-turnover-30d').textContent();
    expect(d30).toMatch(/\$/);
  });

  test('renders points outstanding and redeemed', async ({ page }) => {
    await loadAdminAsAdmin(page);
    const outstanding = await page.locator('#stat-points-outstanding').textContent();
    expect(outstanding).not.toBe('—');
    const redeemed = await page.locator('#stat-points-redeemed').textContent();
    expect(redeemed).not.toBe('—');
  });

  test('renders TBC paid stats', async ({ page }) => {
    await loadAdminAsAdmin(page);
    const count = await page.locator('#stat-tbc-count').textContent();
    expect(count).not.toBe('—');
    const total = await page.locator('#stat-tbc-total').textContent();
    expect(total).toContain('TBC');
    const usd = await page.locator('#stat-tbc-usd').textContent();
    expect(usd).toMatch(/\$/);
  });

  test('renders fraud flags table rows', async ({ page }) => {
    await loadAdminAsAdmin(page);
    const rows = page.locator('#fraud-tbody tr');
    await expect(rows).toHaveCount(3);
  });

  test('renders top users table rows', async ({ page }) => {
    await loadAdminAsAdmin(page);
    const rows = page.locator('#top-users-tbody tr');
    await expect(rows).toHaveCount(10);
  });

  test('resolve button marks flag as resolved and creates an audit entry', async ({ page }) => {
    await loadAdminAsAdmin(page);
    const resolveBtn = page.locator('.resolve-btn').first();
    await resolveBtn.click();
    const badge = page.locator('#fraud-tbody .badge.bg-success').first();
    await expect(badge).toBeVisible();
    const auditRows = page.locator('#audit-tbody tr');
    await expect(auditRows).toHaveCount(1);
    const firstRowText = await auditRows.first().textContent();
    expect(firstRowText).toContain('resolve_fraud_flag');
  });
});
