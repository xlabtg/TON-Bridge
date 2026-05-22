import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

const FIXTURES = {
  stats: {
    stats: {
      turnover: { h24: 1234.56, d7: 12345.67, d30: 123456.78 },
      points_outstanding: 9876,
      points_redeemed: 5432,
      tbc_paid: { count: 12, tbc_total: 345, usd_equiv: 678.9 },
    },
  },
  fraudInitial: {
    total: 3,
    page: 0,
    size: 5,
    items: [
      { id: 11, user_id: 111, reason: 'duplicate_redemption', amount_points: 500, created_at: 1_700_000_000, resolved: 0 },
      { id: 12, user_id: 222, reason: 'velocity_check', amount_points: 250, created_at: 1_700_000_100, resolved: 0 },
      { id: 13, user_id: 333, reason: 'manual_review', amount_points: 100, created_at: 1_700_000_200, resolved: 0 },
    ],
  },
  topUsers: {
    items: Array.from({ length: 10 }, (_, i) => ({
      rank: i + 1,
      user_id: 1000 + i,
      lifetime_usd: (10 - i) * 100,
    })),
  },
  auditEmpty: { items: [] },
  auditAfterResolve: {
    items: [
      {
        actor_id: 12345,
        action: 'resolve_fraud_flag',
        before: { resolved: 0 },
        after: { resolved: 1 },
        created_at: 1_700_000_300,
      },
    ],
  },
};

/**
 * Set up a mock Telegram.WebApp with a given user ID and an allowed admin IDs list.
 * adminIds: null means empty allow-list (nobody is admin), otherwise an array of string IDs.
 *
 * Also intercepts window.fetch for /admin/api/* requests so the page can render
 * without a live worker. We intercept inside the page (rather than via
 * page.route) because the page's <meta http-equiv="Content-Security-Policy">
 * blocks real network requests to test hostnames; patching fetch before
 * admin.js runs sidesteps the CSP entirely.
 */
async function mockTelegramAdmin(page, userId, adminIds, options = {}) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript(({ uid, ids, fixtures, config }) => {
    if (ids !== undefined) {
      window.__adminIds = ids || [];
    }
    if (config) {
      window.__TON_BRIDGE_CONFIG__ = config;
    }
    window.__adminInitData = uid ? 'user=%7B%22id%22%3A' + uid + '%7D' : '';

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
        initData: uid ? 'user=%7B%22id%22%3A' + uid + '%7D' : '',
        BackButton: backButton,
      },
    };

    // In-page mock of the admin API. Patches window.fetch only for paths
    // beginning with /admin/api/ so unrelated requests (e.g. the SW
    // registration script) are unaffected.
    const state = {
      audit: fixtures.auditEmpty,
      fraud: fixtures.fraudInitial,
    };

    function jsonResponse(payload, status) {
      const body = JSON.stringify(payload);
      return new Response(body, {
        status: status || 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || (input && input.method) || 'GET';
      const idx = url.indexOf('/admin/api/');
      if (idx === -1) return originalFetch(input, init);
      const path = url.slice(idx).split('?')[0];

      if (path === '/admin/api/stats') {
        return Promise.resolve(jsonResponse(fixtures.stats));
      }
      if (path === '/admin/api/fraud-flags' && method.toUpperCase() === 'GET') {
        return Promise.resolve(jsonResponse(state.fraud));
      }
      if (path === '/admin/api/fraud-flags/resolve') {
        const body = init && init.body ? JSON.parse(init.body) : {};
        state.fraud = Object.assign({}, state.fraud, {
          items: state.fraud.items.map(function (it) {
            return it.id === body.id ? Object.assign({}, it, { resolved: 1 }) : it;
          }),
        });
        state.audit = fixtures.auditAfterResolve;
        return Promise.resolve(jsonResponse({ ok: true, id: body.id }));
      }
      if (path === '/admin/api/top-users') {
        return Promise.resolve(jsonResponse(fixtures.topUsers));
      }
      if (path === '/admin/api/audit-log') {
        return Promise.resolve(jsonResponse(state.audit));
      }
      return Promise.resolve(new Response('Not found', { status: 404 }));
    };
  }, { uid: userId || null, ids: adminIds, fixtures: FIXTURES, config: options.config || null });
}

test.describe('Admin page — access control', () => {
  test('shows 403 when allow-list is empty', async ({ page }) => {
    await mockTelegramAdmin(page, '99999', []);
    await page.goto(distUrl('admin/index.html'));
    await expect(page.locator('#access-denied')).toBeVisible();
    await expect(page.locator('#admin-content')).toBeHidden();
  });

  test('403 back link returns to the app root', async ({ page }) => {
    await mockTelegramAdmin(page, '99999', []);
    await page.goto(distUrl('admin/index.html'));
    await expect(page.locator('#access-denied')).toBeVisible();
    await expect(page.locator('#access-denied a.btn')).toHaveAttribute('href', '../index.html');
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

  test('uses installer browser config allow-list when static meta still has placeholder', async ({ page }) => {
    await mockTelegramAdmin(page, '12345', undefined, {
      config: {
        adminTelegramIds: ['12345', '67890'],
        workerBaseUrl: 'https://worker.example.com',
      },
    });
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
    await expect(page.locator('#stat-turnover-24h')).not.toHaveText('—');
    const h24 = await page.locator('#stat-turnover-24h').textContent();
    expect(h24).toMatch(/\$/);
    const d7 = await page.locator('#stat-turnover-7d').textContent();
    expect(d7).toMatch(/\$/);
    const d30 = await page.locator('#stat-turnover-30d').textContent();
    expect(d30).toMatch(/\$/);
  });

  test('renders points outstanding and redeemed', async ({ page }) => {
    await loadAdminAsAdmin(page);
    await expect(page.locator('#stat-points-outstanding')).not.toHaveText('—');
    const outstanding = await page.locator('#stat-points-outstanding').textContent();
    expect(outstanding).not.toBe('—');
    const redeemed = await page.locator('#stat-points-redeemed').textContent();
    expect(redeemed).not.toBe('—');
  });

  test('renders TBC paid stats', async ({ page }) => {
    await loadAdminAsAdmin(page);
    await expect(page.locator('#stat-tbc-count')).not.toHaveText('—');
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
