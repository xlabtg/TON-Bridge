/**
 * Integration tests for worker/src/adminPanel.js (issue #121).
 *
 * Uses better-sqlite3 as an in-process D1 substitute (same pattern as
 * redeemHandler.test.js) so we can exercise the SQL against the real
 * migration files without a Cloudflare deployment.
 *
 * Authn is exercised via DEV_MODE=true (initData parsed without HMAC) so we
 * don't need to mint signed Telegram payloads in tests; the HMAC path is
 * covered by worker/tests/auth-verify.test.js.
 *
 * Run with: node --test worker/tests/adminPanel.test.js
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handleAdminPanelRequest,
  parseAdminIds,
  computeAdminStats,
} from '../src/adminPanel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── helpers ──────────────────────────────────────────────────────────────────

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

/** Wrap a better-sqlite3 instance in the D1-style async API the worker expects. */
function wrapD1(db) {
  function prep(sql) {
    let boundArgs = [];
    const stmt = db.prepare(sql);
    const obj = {
      bind(...args) { boundArgs = args; return obj; },
      first()  { return Promise.resolve(stmt.get(...boundArgs) || null); },
      all()    { return Promise.resolve({ results: stmt.all(...boundArgs) }); },
      run()    { return Promise.resolve(stmt.run(...boundArgs)); },
      _stmt()  { return stmt; },
      _args()  { return boundArgs; },
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
    ADMIN_TELEGRAM_IDS: '12345,67890',
    POINTS_PER_TBC: '10',
    POINT_USD_VALUE: '0.0003',
    ...overrides,
  };
}

function fakeInitData(userId) {
  return `user=${encodeURIComponent(JSON.stringify({ id: userId, first_name: 'Admin' }))}`;
}

function getReq(path, opts = {}) {
  const url = new URL('https://worker' + path);
  const headers = new Headers(opts.headers || {});
  return [new Request(url.toString(), { method: 'GET', headers }), url];
}

function postReq(path, body, opts = {}) {
  const url = new URL('https://worker' + path);
  const headers = new Headers(opts.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return [
    new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    url,
  ];
}

/** Insert a finished swap row. */
function seedSwap(db, { id, userId, fromAmount = 1, toAmount = 1, turnoverUsd, finishedAt }) {
  db.prepare(`
    INSERT OR IGNORE INTO users (telegram_id, ref_code, created_at, last_seen)
    VALUES (?, ?, ?, ?)
  `).run(userId, `R${userId}`, 1, 1);

  db.prepare(`
    INSERT INTO swaps
      (id, user_id, from_currency, to_currency, from_amount, to_amount,
       turnover_usd, usd_rate_source, status, created_at, finished_at)
    VALUES (?, ?, 'BTC', 'TON', ?, ?, ?, 'fixed', 'finished', ?, ?)
  `).run(id, userId, fromAmount, toAmount, turnoverUsd, finishedAt, finishedAt);
}

function seedUser(db, telegramId) {
  db.prepare(`
    INSERT OR IGNORE INTO users (telegram_id, ref_code, created_at, last_seen)
    VALUES (?, ?, ?, ?)
  `).run(telegramId, `R${telegramId}`, 1, 1);
}

function seedFraudFlag(db, { id, userId, reason, amount = 0, createdAt, resolved = 0 }) {
  seedUser(db, userId);
  db.prepare(`
    INSERT INTO fraud_flags (id, user_id, reason, amount_points, created_at, resolved)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, reason, amount, createdAt, resolved);
}

// ── parseAdminIds ───────────────────────────────────────────────────────────

describe('parseAdminIds', () => {
  test('parses comma-separated ids and ignores blanks / non-numeric', () => {
    const s = parseAdminIds(' 1, 2,foo,3 , ,4');
    assert.deepEqual([...s].sort((a, b) => a - b), [1, 2, 3, 4]);
  });

  test('returns empty Set for empty / missing input', () => {
    assert.equal(parseAdminIds('').size, 0);
    assert.equal(parseAdminIds(undefined).size, 0);
    assert.equal(parseAdminIds(null).size, 0);
  });
});

// ── /admin/api/stats — authn + authz ─────────────────────────────────────────

describe('GET /admin/api/stats — authentication & authorisation', () => {
  test('401 when initData is missing', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/stats');
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'missing_init_data');
  });

  test('401 when initData lacks a user field (DEV_MODE)', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/stats', {
      headers: { Authorization: 'tma not_a_valid_init_data_string' },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 401);
  });

  test('403 when authenticated user is not in the allow-list', async () => {
    const db = makeDb();
    const env = makeEnv(db, { ADMIN_TELEGRAM_IDS: '99999' });
    const [req, url] = getReq('/admin/api/stats', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'forbidden');
  });

  test('403 when allow-list is empty (locked-down deployment)', async () => {
    const db = makeDb();
    const env = makeEnv(db, { ADMIN_TELEGRAM_IDS: '' });
    const [req, url] = getReq('/admin/api/stats', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 403);
  });

  test('200 when admin id matches allow-list', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/stats', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.stats);
  });

  test('initData via ?initData= query param is accepted', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const [req, url] = getReq(
      '/admin/api/stats?initData=' + encodeURIComponent(fakeInitData(67890))
    );
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 200);
  });
});

// ── /admin/api/stats — payload ──────────────────────────────────────────────

describe('GET /admin/api/stats — payload', () => {
  test('aggregates turnover, points, and TBC payouts from the DB', async () => {
    const db = makeDb();
    const nowS = Math.floor(Date.now() / 1000);
    // 24h window
    seedSwap(db, { id: 's1', userId: 100, turnoverUsd: 100, finishedAt: nowS - 3600 });
    // 7d window (outside 24h)
    seedSwap(db, { id: 's2', userId: 100, turnoverUsd: 200, finishedAt: nowS - 3 * 86400 });
    // 30d window
    seedSwap(db, { id: 's3', userId: 101, turnoverUsd: 50,  finishedAt: nowS - 15 * 86400 });

    // 600 points earned, 100 redeemed
    db.prepare(`INSERT INTO point_ledger (user_id, role, delta_points, created_at) VALUES (?,?,?,?)`)
      .run(100, 'trader', 600, nowS);
    db.prepare(`INSERT INTO point_ledger (user_id, role, delta_points, created_at) VALUES (?,?,?,?)`)
      .run(100, 'redemption', -100, nowS);

    // One paid redemption
    db.prepare(`
      INSERT INTO redemptions (user_id, points_spent, tbc_amount, status, created_at)
      VALUES (?, ?, ?, 'paid', ?)
    `).run(100, 100, 10, nowS);

    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/stats', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.stats.turnover.h24, 100);
    assert.equal(body.stats.turnover.d7,  300);
    assert.equal(body.stats.turnover.d30, 350);
    assert.equal(body.stats.points_outstanding, 500); // 600 - 100
    assert.equal(body.stats.points_redeemed,    100);
    assert.equal(body.stats.tbc_paid.count,      1);
    assert.equal(body.stats.tbc_paid.tbc_total,  10);
    // 10 TBC × 10 points/TBC × $0.0003/point = $0.03
    assert.equal(body.stats.tbc_paid.usd_equiv, 0.03);
  });

  test('counts total and recently-registered users', async () => {
    const db = makeDb();
    const nowS = Math.floor(Date.now() / 1000);
    // within 24h
    db.prepare('INSERT INTO users (telegram_id, ref_code, created_at, last_seen) VALUES (?,?,?,?)')
      .run(100, 'R100', nowS - 3600, nowS);
    // within 7d but not 24h
    db.prepare('INSERT INTO users (telegram_id, ref_code, created_at, last_seen) VALUES (?,?,?,?)')
      .run(101, 'R101', nowS - 3 * 86400, nowS);
    // older than 30d
    db.prepare('INSERT INTO users (telegram_id, ref_code, created_at, last_seen) VALUES (?,?,?,?)')
      .run(102, 'R102', nowS - 40 * 86400, nowS);

    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/stats', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.stats.users.total, 3);
    assert.equal(body.stats.users.new_24h, 1);
    assert.equal(body.stats.users.new_7d, 2);
  });

  test('returns zeros when DB is empty', async () => {
    const db = makeDb();
    const stats = await computeAdminStats(wrapD1Wrapper(db), Math.floor(Date.now() / 1000));
    assert.equal(stats.turnover.h24, 0);
    assert.equal(stats.points_outstanding, 0);
    assert.equal(stats.tbc_paid.count, 0);
    assert.equal(stats.users.total, 0);
    assert.equal(stats.users.new_24h, 0);
    assert.equal(stats.users.new_7d, 0);
  });
});

function wrapD1Wrapper(db) { return wrapD1(db); }

// ── /admin/api/fraud-flags ──────────────────────────────────────────────────

describe('GET /admin/api/fraud-flags', () => {
  test('paginates and orders unresolved-first', async () => {
    const db = makeDb();
    for (let i = 1; i <= 7; i++) {
      seedFraudFlag(db, {
        id: i,
        userId: 100 + i,
        reason: 'r' + i,
        amount: 100 * i,
        createdAt: 1_000 + i,
        resolved: i % 2,
      });
    }
    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/fraud-flags?page=0&size=5', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.total, 7);
    assert.equal(body.items.length, 5);
    // Unresolved (resolved=false) should come first
    assert.equal(body.items[0].resolved, false);
    assert.equal(body.items[1].resolved, false);
  });

  test('403 for non-admin', async () => {
    const db = makeDb();
    const env = makeEnv(db, { ADMIN_TELEGRAM_IDS: '99999' });
    const [req, url] = getReq('/admin/api/fraud-flags', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 403);
  });
});

// ── /admin/api/fraud-flags/resolve ─────────────────────────────────────────

describe('POST /admin/api/fraud-flags/resolve', () => {
  test('marks an unresolved flag as resolved and writes an audit row', async () => {
    const db = makeDb();
    seedFraudFlag(db, { id: 1, userId: 100, reason: 'rapid_redeem', createdAt: 1000 });
    const env = makeEnv(db);

    const [req, url] = postReq('/admin/api/fraud-flags/resolve', { id: 1 }, {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.id, 1);

    const row = db.prepare('SELECT resolved, resolved_by FROM fraud_flags WHERE id = 1').get();
    assert.equal(row.resolved, 1);
    assert.equal(row.resolved_by, 12345);

    const audit = db.prepare("SELECT * FROM audit_log WHERE action='resolve_fraud_flag'").get();
    assert.ok(audit);
    assert.equal(audit.actor_id, 12345);
    assert.equal(audit.target, 'fraud_flag:1');
    assert.equal(audit.before_json, JSON.stringify({ resolved: false }));
    assert.equal(audit.after_json, JSON.stringify({ resolved: true }));
  });

  test('409 when flag is already resolved', async () => {
    const db = makeDb();
    seedFraudFlag(db, { id: 1, userId: 100, reason: 'r', createdAt: 1000, resolved: 1 });
    const env = makeEnv(db);

    const [req, url] = postReq('/admin/api/fraud-flags/resolve', { id: 1 }, {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 409);
  });

  test('404 when flag id does not exist', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const [req, url] = postReq('/admin/api/fraud-flags/resolve', { id: 999 }, {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 404);
  });

  test('400 on missing / invalid id', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const [req, url] = postReq('/admin/api/fraud-flags/resolve', { id: 'not-a-number' }, {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 400);
  });

  test('403 for non-admin', async () => {
    const db = makeDb();
    seedFraudFlag(db, { id: 1, userId: 100, reason: 'r', createdAt: 1000 });
    const env = makeEnv(db, { ADMIN_TELEGRAM_IDS: '99999' });
    const [req, url] = postReq('/admin/api/fraud-flags/resolve', { id: 1 }, {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 403);
  });
});

// ── /admin/api/top-users ────────────────────────────────────────────────────

describe('GET /admin/api/top-users', () => {
  test('returns rows sorted by lifetime turnover desc', async () => {
    const db = makeDb();
    seedSwap(db, { id: 's1', userId: 100, turnoverUsd: 1000, finishedAt: 1 });
    seedSwap(db, { id: 's2', userId: 100, turnoverUsd: 500,  finishedAt: 2 });
    seedSwap(db, { id: 's3', userId: 200, turnoverUsd: 2000, finishedAt: 3 });
    seedSwap(db, { id: 's4', userId: 300, turnoverUsd: 100,  finishedAt: 4 });

    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/top-users', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.items.length, 3);
    assert.equal(body.items[0].rank, 1);
    assert.equal(body.items[0].user_id, 200);
    assert.equal(body.items[0].lifetime_usd, 2000);
    assert.equal(body.items[1].user_id, 100);
    assert.equal(body.items[1].lifetime_usd, 1500);
    assert.equal(body.items[2].user_id, 300);
  });

  test('403 for non-admin', async () => {
    const db = makeDb();
    const env = makeEnv(db, { ADMIN_TELEGRAM_IDS: '' });
    const [req, url] = getReq('/admin/api/top-users', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 403);
  });
});

// ── /admin/api/users ────────────────────────────────────────────────────────

describe('GET /admin/api/users', () => {
  test('returns most recently registered users with points balance', async () => {
    const db = makeDb();
    const nowS = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO users (telegram_id, ref_code, created_at, last_seen) VALUES (?,?,?,?)')
      .run(100, 'R100', nowS - 100, nowS - 10);
    db.prepare('INSERT INTO users (telegram_id, ref_code, created_at, last_seen) VALUES (?,?,?,?)')
      .run(101, 'R101', nowS - 50, nowS - 5);
    // 250 points credited to user 101
    db.prepare('INSERT INTO point_ledger (user_id, role, delta_points, created_at) VALUES (?,?,?,?)')
      .run(101, 'trader', 250, nowS);

    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/users', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.items.length, 2);
    // Newest first (created_at desc): 101 then 100.
    assert.equal(body.items[0].user_id, 101);
    assert.equal(body.items[0].points, 250);
    assert.equal(body.items[0].last_seen, nowS - 5);
    assert.equal(body.items[1].user_id, 100);
    assert.equal(body.items[1].points, 0);
  });

  test('401 without initData', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/users');
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 401);
  });

  test('403 for non-admin', async () => {
    const db = makeDb();
    const env = makeEnv(db, { ADMIN_TELEGRAM_IDS: '99999' });
    const [req, url] = getReq('/admin/api/users', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 403);
  });
});

// ── /admin/api/audit-log ────────────────────────────────────────────────────

describe('GET /admin/api/audit-log', () => {
  test('returns recent audit-log entries', async () => {
    const db = makeDb();
    seedFraudFlag(db, { id: 1, userId: 100, reason: 'r', createdAt: 1000 });

    // Trigger a resolve to create an audit-log row through the handler.
    const env = makeEnv(db);
    const [r1, u1] = postReq('/admin/api/fraud-flags/resolve', { id: 1 }, {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const resolve = await handleAdminPanelRequest(r1, u1, env);
    assert.equal(resolve.status, 200);

    const [r2, u2] = getReq('/admin/api/audit-log', {
      headers: { Authorization: 'tma ' + fakeInitData(12345) },
    });
    const res = await handleAdminPanelRequest(r2, u2, env);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].action, 'resolve_fraud_flag');
    assert.equal(body.items[0].actor_id, 12345);
    assert.deepEqual(body.items[0].before, { resolved: false });
    assert.deepEqual(body.items[0].after,  { resolved: true });
  });

  test('401 without initData', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const [req, url] = getReq('/admin/api/audit-log');
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res.status, 401);
  });
});

// ── Router fall-through ────────────────────────────────────────────────────

describe('handleAdminPanelRequest', () => {
  test('returns null for unrelated paths', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const [req, url] = getReq('/some/other/path');
    const res = await handleAdminPanelRequest(req, url, env);
    assert.equal(res, null);
  });
});
