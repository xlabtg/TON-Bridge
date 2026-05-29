/**
 * Admin-panel ↔ worker contract smoke check (issue #186, audit finding R6).
 *
 * The admin panel UI (`src/_includes/admin-page.njk` + `assets/js/admin.js`)
 * renders every view purely from data fetched off the Cloudflare Worker. If a
 * view's backing endpoint is ever dropped from the worker — or shipped without
 * the admin auth gate — the corresponding panel would silently fall back to
 * empty/placeholder data in production (exactly the regression R6 warns about).
 *
 * This test enforces a positive contract so that cannot regress on deploy:
 *
 *   1. Every `/admin/api/*` path the *client* actually calls (extracted from
 *      `assets/js/admin.js`) is routed by `handleAdminPanelRequest` — i.e. the
 *      deployed worker backs it (not a 404 fall-through).
 *   2. Each of those endpoints is authorised: it rejects missing initData (401)
 *      and a non-allow-listed user (403), and only lets an allow-listed admin
 *      through the gate.
 *   3. The worker entrypoint (`worker/src/index.js`) actually mounts the admin
 *      router behind the `/admin/api/` prefix — so the handlers are reachable
 *      once deployed, not just dead exports.
 *   4. The static admin page's CSP `connect-src` allows the worker origin the
 *      client defaults to, so the browser is permitted to reach it.
 *
 * Run with: node --test worker/tests/adminPanelContract.test.js
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';

import { handleAdminPanelRequest } from '../src/adminPanel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

// ── repo files under contract ────────────────────────────────────────────────

const ADMIN_JS = readFileSync(join(repoRoot, 'assets/js/admin.js'), 'utf8');
const ADMIN_NJK = readFileSync(join(repoRoot, 'src/_includes/admin-page.njk'), 'utf8');
const WORKER_INDEX = readFileSync(join(__dirname, '../src/index.js'), 'utf8');

// ── extract the endpoints the client actually calls ──────────────────────────

/**
 * Scan admin.js for every apiGet('…')/apiPost('…') call and normalise it to a
 * { method, path } pair (query string stripped). This is the authoritative list
 * of views-backing endpoints — derived from the shipping client, not hand-kept.
 */
function extractClientEndpoints(src) {
  const re = /\bapi(Get|Post)\(\s*(['"])([^'"]+)\2/g;
  const found = new Map();
  let m;
  while ((m = re.exec(src)) !== null) {
    const method = m[1] === 'Get' ? 'GET' : 'POST';
    const path = m[3].split('?')[0]; // drop '?page=' + … runtime query
    found.set(method + ' ' + path, { method, path });
  }
  return [...found.values()];
}

const CLIENT_ENDPOINTS = extractClientEndpoints(ADMIN_JS);

// The eight admin views and the endpoint each is rendered from. Kept explicit so
// the test doubles as living documentation and fails loudly if a view loses its
// backing call. (Several stat cards share /admin/api/stats.)
const VIEW_ENDPOINTS = [
  { view: 'Platform Turnover', method: 'GET', path: '/admin/api/stats' },
  { view: 'Users', method: 'GET', path: '/admin/api/stats' },
  { view: 'Points', method: 'GET', path: '/admin/api/stats' },
  { view: 'TBC Paid Out', method: 'GET', path: '/admin/api/stats' },
  { view: 'Fraud Flags', method: 'GET', path: '/admin/api/fraud-flags' },
  { view: 'Fraud Flags — resolve', method: 'POST', path: '/admin/api/fraud-flags/resolve' },
  { view: 'Top Users', method: 'GET', path: '/admin/api/top-users' },
  { view: 'Recent Users', method: 'GET', path: '/admin/api/users' },
  { view: 'Audit Log', method: 'GET', path: '/admin/api/audit-log' },
];

// ── in-process D1 substitute (same pattern as adminPanel.test.js) ─────────────

function makeDb() {
  const db = new Database(':memory:');
  for (const file of [
    '0001_affiliate.sql',
    '0002_accrual_cursor.sql',
    '0003_program_config.sql',
    '0004_admin_tables.sql',
  ]) {
    db.exec(readFileSync(join(__dirname, '../migrations', file), 'utf8'));
  }
  return db;
}

function wrapD1(db) {
  function prep(sql) {
    let boundArgs = [];
    const stmt = db.prepare(sql);
    const obj = {
      bind(...args) { boundArgs = args; return obj; },
      first() { return Promise.resolve(stmt.get(...boundArgs) || null); },
      all() { return Promise.resolve({ results: stmt.all(...boundArgs) }); },
      run() { return Promise.resolve(stmt.run(...boundArgs)); },
      _stmt() { return stmt; },
      _args() { return boundArgs; },
    };
    return obj;
  }
  return {
    prepare: prep,
    batch(stmts) {
      const results = stmts.map(s => {
        const r = s._stmt().run(...s._args());
        return { meta: { last_row_id: r.lastInsertRowid } };
      });
      return Promise.resolve(results);
    },
  };
}

function makeEnv(db, overrides = {}) {
  return {
    DB: wrapD1(db),
    DEV_MODE: 'true',
    BOT_TOKEN: '',
    ADMIN_TELEGRAM_IDS: '12345',
    POINTS_PER_TBC: '10',
    POINT_USD_VALUE: '0.0003',
    ...overrides,
  };
}

function fakeInitData(userId) {
  return `user=${encodeURIComponent(JSON.stringify({ id: userId, first_name: 'Admin' }))}`;
}

function makeReq({ method, path, headers = {}, body }) {
  const url = new URL('https://worker' + path);
  const h = new Headers(headers);
  const init = { method, headers: h };
  if (method === 'POST') {
    if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
    init.body = JSON.stringify(body || {});
  }
  return [new Request(url.toString(), init), url];
}

// A POST body that satisfies each known endpoint's validation, so a reachable +
// authorised admin gets *past* the auth gate (200/4xx other than 401/403),
// proving the gate — not a payload error — is what rejected the unauth cases.
function bodyFor(path) {
  if (path === '/admin/api/fraud-flags/resolve') return { id: 1 };
  return {};
}

// ── 1. client endpoints are the ones we documented ──────────────────────────

describe('admin panel ↔ worker contract: endpoint enumeration', () => {
  test('admin.js calls exactly the documented view-backing endpoints', () => {
    const documented = new Set(VIEW_ENDPOINTS.map(v => v.method + ' ' + v.path));
    const called = new Set(CLIENT_ENDPOINTS.map(e => e.method + ' ' + e.path));

    // Every endpoint the client calls must be accounted for in VIEW_ENDPOINTS…
    for (const key of called) {
      assert.ok(
        documented.has(key),
        `admin.js calls ${key} but it is not enumerated in VIEW_ENDPOINTS — ` +
        `add the new view + its backing endpoint to keep the contract honest.`,
      );
    }
    // …and every documented endpoint must still be called by the client.
    for (const key of documented) {
      assert.ok(
        called.has(key),
        `VIEW_ENDPOINTS lists ${key} but no apiGet/apiPost in admin.js calls it ` +
        `(view lost its backing call?).`,
      );
    }
  });

  test('every admin view has a non-empty backing endpoint', () => {
    for (const v of VIEW_ENDPOINTS) {
      assert.match(v.path, /^\/admin\/api\//, `view "${v.view}" has a malformed endpoint`);
    }
  });
});

// ── 2. each endpoint is routed (backed by the deployed worker) ───────────────

describe('admin panel ↔ worker contract: each view is backed by a worker route', () => {
  for (const { view, method, path } of VIEW_ENDPOINTS) {
    test(`${view} → ${method} ${path} is routed (not a 404 fall-through)`, async () => {
      const env = makeEnv(makeDb());
      const [req, url] = makeReq({
        method, path,
        headers: { Authorization: 'tma ' + fakeInitData(12345) },
        body: bodyFor(path),
      });
      const res = await handleAdminPanelRequest(req, url, env);
      assert.notEqual(
        res, null,
        `${method} ${path} fell through the admin router — the deployed worker ` +
        `would 404 and the "${view}" view would show placeholder/empty data.`,
      );
    });
  }
});

// ── 3. each endpoint is authorised ───────────────────────────────────────────

describe('admin panel ↔ worker contract: each endpoint is authorised', () => {
  for (const { view, method, path } of VIEW_ENDPOINTS) {
    test(`${view} → ${method} ${path} rejects missing initData with 401`, async () => {
      const env = makeEnv(makeDb());
      const [req, url] = makeReq({ method, path, body: bodyFor(path) });
      const res = await handleAdminPanelRequest(req, url, env);
      assert.equal(res.status, 401, `${method} ${path} did not require authentication`);
    });

    test(`${view} → ${method} ${path} rejects a non-allow-listed user with 403`, async () => {
      const env = makeEnv(makeDb(), { ADMIN_TELEGRAM_IDS: '99999' });
      const [req, url] = makeReq({
        method, path,
        headers: { Authorization: 'tma ' + fakeInitData(12345) },
        body: bodyFor(path),
      });
      const res = await handleAdminPanelRequest(req, url, env);
      assert.equal(res.status, 403, `${method} ${path} did not enforce the allow-list`);
    });

    test(`${view} → ${method} ${path} lets an allow-listed admin past the gate`, async () => {
      const env = makeEnv(makeDb());
      const [req, url] = makeReq({
        method, path,
        headers: { Authorization: 'tma ' + fakeInitData(12345) },
        body: bodyFor(path),
      });
      const res = await handleAdminPanelRequest(req, url, env);
      // Past the auth gate ⇒ not 401/403. Some endpoints may legitimately 404/409
      // (e.g. resolving a non-existent flag) — that still proves the gate passed.
      assert.notEqual(res.status, 401, `admin was rejected as unauthenticated on ${path}`);
      assert.notEqual(res.status, 403, `admin was rejected as unauthorised on ${path}`);
    });
  }
});

// ── 4. the worker entrypoint actually mounts the admin router ────────────────

describe('admin panel ↔ worker contract: router is mounted in the deployed worker', () => {
  test('index.js imports and dispatches handleAdminPanelRequest behind /admin/api/', () => {
    assert.match(
      WORKER_INDEX,
      /import\s*\{[^}]*\bhandleAdminPanelRequest\b[^}]*\}\s*from\s*['"]\.\/adminPanel\.js['"]/,
      'worker/src/index.js does not import handleAdminPanelRequest',
    );
    assert.match(
      WORKER_INDEX,
      /url\.pathname\.startsWith\(\s*['"]\/admin\/api\/['"]\s*\)/,
      'worker/src/index.js does not gate the /admin/api/ prefix',
    );
    assert.match(
      WORKER_INDEX,
      /handleAdminPanelRequest\s*\(/,
      'worker/src/index.js imports but never calls handleAdminPanelRequest',
    );
  });
});

// ── 5. the admin page CSP allows reaching the worker origin ──────────────────

describe('admin panel ↔ worker contract: CSP allows the worker origin', () => {
  let defaultApiBase;

  before(() => {
    const m = ADMIN_JS.match(/DEFAULT_API_BASE\s*=\s*['"]([^'"]+)['"]/);
    assert.ok(m, 'could not find DEFAULT_API_BASE in admin.js');
    defaultApiBase = m[1];
  });

  test('CSP connect-src in admin-page.njk allows the default worker base', () => {
    const csp = ADMIN_NJK.match(/Content-Security-Policy"\s+content="([^"]+)"/);
    assert.ok(csp, 'no CSP meta tag found in admin-page.njk');
    assert.ok(
      csp[1].includes(defaultApiBase),
      `admin page CSP connect-src does not allow ${defaultApiBase}; the browser ` +
      `would block every admin fetch and all views would fail to load.`,
    );
  });
});
