/**
 * Unit tests for rateConfig.js and adminConfig.js (issue #55 — Phase 6.12)
 *
 * Tests:
 *   - parseRateConfig: valid defaults, individual overrides, range errors, consistency errors
 *   - seedConfigOnBoot: inserts on first call, no-op on second call
 *   - getActiveConfig: returns correct row given effective_at ordering
 *   - handleAdminConfig: auth, validation, scheduling, persistence
 *   - nextMinuteBoundary: arithmetic
 *
 * Uses Node.js built-in test runner (node --test).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseRateConfig, DEFAULTS, insertProgramConfig, getActiveConfig, seedConfigOnBoot } from '../src/rateConfig.js';
import { handleAdminConfig, nextMinuteBoundary } from '../src/adminConfig.js';

// ---------------------------------------------------------------------------
// In-memory SQLite DB (mirrors the migration DDL)
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeDb() {
  const db = new Database(':memory:');

  // Apply base migration (0001) so point_ledger exists for the ALTER TABLE
  const sql0001 = readFileSync(join(__dirname, '../migrations/0001_affiliate.sql'), 'utf8');
  db.exec(sql0001);

  // Apply 0003 migration (program_config + ALTER TABLE point_ledger)
  const sql0003 = readFileSync(join(__dirname, '../migrations/0003_program_config.sql'), 'utf8');
  db.exec(sql0003);

  return db;
}

// Thin D1-compatible wrapper around better-sqlite3
function wrapDb(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind(...args) {
          return {
            first() {
              return Promise.resolve(stmt.get(...args) ?? null);
            },
            run() {
              const info = stmt.run(...args);
              return Promise.resolve({ meta: { last_row_id: info.lastInsertRowid } });
            },
            all() {
              return Promise.resolve({ results: stmt.all(...args) });
            },
          };
        },
        first() {
          return Promise.resolve(stmt.get() ?? null);
        },
        run() {
          const info = stmt.run();
          return Promise.resolve({ meta: { last_row_id: info.lastInsertRowid } });
        },
      };
    },
    async batch(stmts) {
      const results = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results;
    },
  };
}

// ---------------------------------------------------------------------------
// parseRateConfig
// ---------------------------------------------------------------------------

describe('parseRateConfig', () => {
  test('returns defaults when env is empty', () => {
    const cfg = parseRateConfig({});
    assert.equal(cfg.serviceBps,          DEFAULTS.SERVICE_BPS);
    assert.equal(cfg.cashbackBps,         DEFAULTS.CASHBACK_BPS);
    assert.equal(cfg.referralBps,         DEFAULTS.REFERRAL_BPS);
    assert.equal(cfg.pointUsdValue,       DEFAULTS.POINT_USD_VALUE);
    assert.equal(cfg.pointsPerTbc,        DEFAULTS.POINTS_PER_TBC);
    assert.equal(cfg.minRedeemPoints,     DEFAULTS.MIN_REDEEM_POINTS);
    assert.equal(cfg.dailyTurnoverCapUsd, DEFAULTS.DAILY_TURNOVER_CAP_USD);
  });

  test('parses string values from env (Cloudflare vars are strings)', () => {
    const cfg = parseRateConfig({ CASHBACK_BPS: '15', REFERRAL_BPS: '15', SERVICE_BPS: '40' });
    assert.equal(cfg.cashbackBps,  15);
    assert.equal(cfg.referralBps,  15);
    assert.equal(cfg.serviceBps,   40);
  });

  test('throws when a knob is NaN', () => {
    assert.throws(
      () => parseRateConfig({ CASHBACK_BPS: 'not-a-number' }),
      /CASHBACK_BPS is not a finite number/,
    );
  });

  test('throws when SERVICE_BPS is 0', () => {
    assert.throws(
      () => parseRateConfig({ SERVICE_BPS: 0 }),
      /SERVICE_BPS=0 is out of range/,
    );
  });

  test('throws when CASHBACK_BPS is negative', () => {
    assert.throws(
      () => parseRateConfig({ CASHBACK_BPS: -1 }),
      /CASHBACK_BPS=-1 is out of range/,
    );
  });

  test('throws when cashback + referral > service (house loss)', () => {
    assert.throws(
      () => parseRateConfig({ SERVICE_BPS: 30, CASHBACK_BPS: 20, REFERRAL_BPS: 20 }),
      /exceeds service_bps/,
    );
  });

  test('accepts cashback + referral exactly equal to service', () => {
    const cfg = parseRateConfig({ SERVICE_BPS: 40, CASHBACK_BPS: 20, REFERRAL_BPS: 20 });
    assert.equal(cfg.cashbackBps + cfg.referralBps, cfg.serviceBps);
  });

  test('throws when POINT_USD_VALUE is 0', () => {
    assert.throws(
      () => parseRateConfig({ POINT_USD_VALUE: 0 }),
      /POINT_USD_VALUE/,
    );
  });

  test('throws when POINTS_PER_TBC is 0', () => {
    assert.throws(
      () => parseRateConfig({ POINTS_PER_TBC: 0 }),
      /POINTS_PER_TBC/,
    );
  });

  test('accepts all-zero rebates (zero cashback and referral)', () => {
    const cfg = parseRateConfig({ CASHBACK_BPS: 0, REFERRAL_BPS: 0 });
    assert.equal(cfg.cashbackBps, 0);
    assert.equal(cfg.referralBps, 0);
  });
});

// ---------------------------------------------------------------------------
// nextMinuteBoundary
// ---------------------------------------------------------------------------

describe('nextMinuteBoundary', () => {
  test('returns start of next minute', () => {
    // 1_700_000_047 / 60 = 28_333_334.116... → floor = 28_333_334
    // (28_333_334 + 1) * 60 = 1_700_000_100
    const t = 1_700_000_047;
    assert.equal(nextMinuteBoundary(t), 1_700_000_100);
  });

  test('returns next minute when exactly on minute boundary', () => {
    // 1_700_000_100 / 60 = 28_333_335 exactly → floor = 28_333_335
    // (28_333_335 + 1) * 60 = 1_700_000_160
    const t = 1_700_000_100;
    assert.equal(nextMinuteBoundary(t), 1_700_000_160);
  });
});

// ---------------------------------------------------------------------------
// seedConfigOnBoot
// ---------------------------------------------------------------------------

describe('seedConfigOnBoot', () => {
  test('inserts first config row on empty table', async () => {
    const db = wrapDb(makeDb());
    const cfg = parseRateConfig({});
    await seedConfigOnBoot(db, cfg);
    const row = await db.prepare('SELECT COUNT(*) AS n FROM program_config').first();
    assert.equal(row.n, 1);
  });

  test('is a no-op when a row already exists', async () => {
    const db = wrapDb(makeDb());
    const cfg = parseRateConfig({});
    await seedConfigOnBoot(db, cfg);
    await seedConfigOnBoot(db, cfg); // second call
    const row = await db.prepare('SELECT COUNT(*) AS n FROM program_config').first();
    assert.equal(row.n, 1);
  });
});

// ---------------------------------------------------------------------------
// insertProgramConfig / getActiveConfig
// ---------------------------------------------------------------------------

describe('insertProgramConfig + getActiveConfig', () => {
  test('inserted row is retrievable as active config', async () => {
    const db = wrapDb(makeDb());
    const cfg = parseRateConfig({ CASHBACK_BPS: 15, REFERRAL_BPS: 15 });
    const now = Math.floor(Date.now() / 1000);
    await insertProgramConfig(db, cfg, 'boot', now);

    const active = await getActiveConfig(db);
    assert.ok(active);
    assert.equal(active.cashback_bps, 15);
    assert.equal(active.referral_bps, 15);
  });

  test('getActiveConfig returns the most recent past config', async () => {
    const db = wrapDb(makeDb());
    const now = Math.floor(Date.now() / 1000);

    const cfg1 = parseRateConfig({ CASHBACK_BPS: 5, REFERRAL_BPS: 5 });
    await insertProgramConfig(db, cfg1, 'boot', now - 3600); // 1 hour ago

    const cfg2 = parseRateConfig({ CASHBACK_BPS: 10, REFERRAL_BPS: 10 });
    await insertProgramConfig(db, cfg2, 'admin:42', now - 60); // 1 minute ago

    const active = await getActiveConfig(db);
    assert.equal(active.cashback_bps, 10);
  });

  test('future-scheduled config is not yet active', async () => {
    const db = wrapDb(makeDb());
    const now = Math.floor(Date.now() / 1000);

    const cfg1 = parseRateConfig({ CASHBACK_BPS: 5, REFERRAL_BPS: 5 });
    await insertProgramConfig(db, cfg1, 'boot', now - 60); // past

    const cfg2 = parseRateConfig({ CASHBACK_BPS: 10, REFERRAL_BPS: 10 });
    await insertProgramConfig(db, cfg2, 'admin:42', now + 120); // future

    const active = await getActiveConfig(db);
    assert.equal(active.cashback_bps, 5); // future row not yet active
  });
});

// ---------------------------------------------------------------------------
// handleAdminConfig
// ---------------------------------------------------------------------------

describe('handleAdminConfig', () => {
  function makeEnv(db, overrides = {}) {
    return {
      DB:           db,
      ADMIN_SECRET: 'test-secret',
      SERVICE_BPS:  '40',
      CASHBACK_BPS: '10',
      REFERRAL_BPS: '10',
      ...overrides,
    };
  }

  function makeRequest(body, token = 'test-secret') {
    return new Request('https://worker.example/admin/config', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  test('rejects requests with wrong token', async () => {
    const db = wrapDb(makeDb());
    const res = await handleAdminConfig(makeRequest({}, 'wrong'), makeEnv(db));
    assert.equal(res.status, 401);
  });

  test('rejects requests with no Authorization header', async () => {
    const db = wrapDb(makeDb());
    const req = new Request('https://worker.example/admin/config', {
      method: 'POST',
      body:   JSON.stringify({}),
    });
    const res = await handleAdminConfig(req, makeEnv(db));
    assert.equal(res.status, 401);
  });

  test('rejects invalid JSON body', async () => {
    const db = wrapDb(makeDb());
    const req = new Request('https://worker.example/admin/config', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer test-secret' },
      body:    'not-json',
    });
    const res = await handleAdminConfig(req, makeEnv(db));
    assert.equal(res.status, 400);
  });

  test('rejects config that would cause house loss', async () => {
    const db = wrapDb(makeDb());
    const res = await handleAdminConfig(
      makeRequest({ cashback_bps: 30, referral_bps: 30 }),
      makeEnv(db),
    );
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.ok(body.detail.includes('exceeds service_bps'));
  });

  test('accepts valid config and persists audit row', async () => {
    const db = wrapDb(makeDb());
    const res = await handleAdminConfig(
      makeRequest({ cashback_bps: 8, referral_bps: 8, proposed_by: '12345' }),
      makeEnv(db),
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.ok);
    assert.ok(body.config_id > 0);
    assert.ok(body.effective_at > Math.floor(Date.now() / 1000));
    assert.equal(body.config.cashbackBps, 8);
  });

  test('effective_at is set to next minute boundary', async () => {
    const db = wrapDb(makeDb());
    const before = Math.floor(Date.now() / 1000);
    const res = await handleAdminConfig(
      makeRequest({ cashback_bps: 5, referral_bps: 5 }),
      makeEnv(db),
    );
    const body = await res.json();
    const expectedMinute = (Math.floor(before / 60) + 1) * 60;
    // Allow ±1 second for execution time
    assert.ok(Math.abs(body.effective_at - expectedMinute) <= 1);
  });

  test('new config is not immediately active (only at next minute)', async () => {
    const db = wrapDb(makeDb());
    const cfg0 = parseRateConfig({ CASHBACK_BPS: 5, REFERRAL_BPS: 5 });

    // Seed an initial past config
    await insertProgramConfig(db, cfg0, 'boot', Math.floor(Date.now() / 1000) - 3600);

    // Propose new rates — will be effective at next minute boundary (future)
    await handleAdminConfig(
      makeRequest({ cashback_bps: 15, referral_bps: 15 }),
      makeEnv(db),
    );

    // Active config should still be the old one (new one is in the future)
    const active = await getActiveConfig(db);
    assert.equal(active.cashback_bps, 5);
  });

  test('accepts camelCase keys in proposal', async () => {
    const db = wrapDb(makeDb());
    const res = await handleAdminConfig(
      makeRequest({ cashbackBps: 8, referralBps: 8 }),
      makeEnv(db),
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.config.cashbackBps, 8);
  });
});

// ---------------------------------------------------------------------------
// point_ledger config_id column (migration smoke test)
// ---------------------------------------------------------------------------

describe('Migration 0003 smoke test', () => {
  test('program_config table exists with expected columns', () => {
    const rawDb = makeDb();
    const cols = rawDb.prepare("PRAGMA table_info(program_config)").all();
    const names = cols.map(c => c.name);
    assert.ok(names.includes('id'));
    assert.ok(names.includes('cashback_bps'));
    assert.ok(names.includes('referral_bps'));
    assert.ok(names.includes('service_bps'));
    assert.ok(names.includes('point_usd_value'));
    assert.ok(names.includes('points_per_tbc'));
    assert.ok(names.includes('min_redeem_pts'));
    assert.ok(names.includes('daily_cap_usd'));
    assert.ok(names.includes('proposed_by'));
    assert.ok(names.includes('effective_at'));
  });

  test('point_ledger has config_id column after migration', () => {
    const rawDb = makeDb();
    const cols = rawDb.prepare("PRAGMA table_info(point_ledger)").all();
    const names = cols.map(c => c.name);
    assert.ok(names.includes('config_id'));
  });
});
