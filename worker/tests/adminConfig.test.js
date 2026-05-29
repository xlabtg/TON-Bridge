/**
 * Unit tests for the runtime rate-knob update endpoint (issue #55 — Phase 6.12)
 *
 * Run: node --test worker/tests/adminConfig.test.js
 *
 * Tests cover:
 *   1. handleAdminConfig — auth, bad JSON, validation, happy path, merge logic
 *   2. nextMinuteBoundary — boundary maths
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { handleAdminConfig, nextMinuteBoundary } from '../src/adminConfig.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = 'super-secret';

/**
 * Build a mock D1 database.
 *
 * @param {object|null} activeRow - row returned by getActiveConfig's query
 */
function makeDb(activeRow = null) {
  const inserts = [];
  let nextId = 1;

  const db = {
    _inserts: inserts,
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _vals: [],
        bind(...vals) {
          this._vals = vals;
          return this;
        },
        async first() {
          if (stmt._sql.includes('FROM program_config')) {
            return activeRow;
          }
          return null;
        },
        async run() {
          if (stmt._sql.includes('INSERT INTO program_config')) {
            const id = nextId++;
            inserts.push({ id, vals: stmt._vals });
            return { meta: { last_row_id: id } };
          }
          return { meta: {} };
        },
      };
      return stmt;
    },
  };
  return db;
}

function makeEnv(activeRow = null, overrides = {}) {
  return {
    DB: makeDb(activeRow),
    ADMIN_SECRET: SECRET,
    ...overrides,
  };
}

/**
 * Build a real Request with a JSON (or raw) body.
 */
function makeRequest(body, { auth = `Bearer ${SECRET}`, raw = false } = {}) {
  const headers = {};
  if (auth !== null) headers.Authorization = auth;
  headers['Content-Type'] = 'application/json';
  return new Request('https://worker.example.com/admin/config', {
    method: 'POST',
    headers,
    body: raw ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 1. handleAdminConfig
// ---------------------------------------------------------------------------

describe('handleAdminConfig — auth', () => {
  test('returns 401 when Authorization header is missing', async () => {
    const res = await handleAdminConfig(makeRequest({}, { auth: null }), makeEnv());
    assert.equal(res.status, 401);
  });

  test('returns 401 when the bearer token is wrong', async () => {
    const res = await handleAdminConfig(makeRequest({}, { auth: 'Bearer nope' }), makeEnv());
    assert.equal(res.status, 401);
  });

  test('returns 401 when ADMIN_SECRET is unset (no token grants access)', async () => {
    const env = makeEnv(null, {});
    delete env.ADMIN_SECRET;
    const res = await handleAdminConfig(makeRequest({}, { auth: 'Bearer ' }), env);
    assert.equal(res.status, 401);
  });
});

describe('handleAdminConfig — body parsing & validation', () => {
  test('returns 400 on invalid JSON', async () => {
    const res = await handleAdminConfig(makeRequest('{not json', { raw: true }), makeEnv());
    assert.equal(res.status, 400);
  });

  test('returns 422 when the merged config violates a constraint', async () => {
    // cashback + referral must not exceed service_bps. With env defaults
    // (service 40) a cashback of 9000 bps blows the constraint.
    const res = await handleAdminConfig(makeRequest({ cashback_bps: 9000 }), makeEnv());
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.equal(json.error, 'validation_failed');
  });

  test('returns 422 when a knob is out of range', async () => {
    const res = await handleAdminConfig(makeRequest({ service_bps: 0 }), makeEnv());
    assert.equal(res.status, 422);
  });
});

describe('handleAdminConfig — happy path', () => {
  test('persists a config row and returns 201 with the parsed config', async () => {
    const env = makeEnv();
    const res = await handleAdminConfig(makeRequest({ service_bps: 60, cashback_bps: 20 }), env);
    assert.equal(res.status, 201);

    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.config_id, 1);
    assert.equal(json.config.serviceBps, 60);
    assert.equal(json.config.cashbackBps, 20);
    // effective_at lands on a future minute boundary
    assert.equal(json.effective_at % 60, 0);
    assert.equal(typeof json.effective_at_iso, 'string');

    // exactly one row inserted, proposed_by carries the admin prefix
    assert.equal(env.DB._inserts.length, 1);
    const inserted = env.DB._inserts[0];
    assert.ok(inserted.vals.includes('admin:unknown'));
  });

  test('accepts camelCase keys too', async () => {
    const res = await handleAdminConfig(makeRequest({ serviceBps: 50, referralBps: 5 }), makeEnv());
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.config.serviceBps, 50);
    assert.equal(json.config.referralBps, 5);
  });

  test('merges proposed knobs on top of the active DB config', async () => {
    // Active config has service_bps = 100; the proposal only tweaks cashback.
    // The merged service_bps must remain 100, proving the merge happened.
    const activeRow = {
      service_bps: 100,
      cashback_bps: 10,
      referral_bps: 10,
      point_usd_value: 0.00003,
      points_per_tbc: 10,
      min_redeem_pts: 100,
      daily_cap_usd: 50000,
    };
    const res = await handleAdminConfig(makeRequest({ cashback_bps: 50 }), makeEnv(activeRow));
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.config.serviceBps, 100);
    assert.equal(json.config.cashbackBps, 50);
  });

  test('records the supplied proposed_by in the audit row', async () => {
    const env = makeEnv();
    const res = await handleAdminConfig(makeRequest({ proposed_by: 42, service_bps: 60 }), env);
    assert.equal(res.status, 201);
    assert.ok(env.DB._inserts[0].vals.includes('admin:42'));
  });
});

// ---------------------------------------------------------------------------
// 2. nextMinuteBoundary
// ---------------------------------------------------------------------------

describe('nextMinuteBoundary', () => {
  test('rounds 12:34:47 up to 12:35:00', () => {
    // 12:34:47 = 45287 s past some hour base; just verify the maths generally
    assert.equal(nextMinuteBoundary(47), 60);
    assert.equal(nextMinuteBoundary(60), 120);
    assert.equal(nextMinuteBoundary(119), 120);
    assert.equal(nextMinuteBoundary(0), 60);
  });
});
