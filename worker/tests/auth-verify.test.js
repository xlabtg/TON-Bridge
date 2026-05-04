/**
 * Unit tests for captureReferredBy (issue #6.3).
 *
 * Covers all five validation branches from the acceptance criteria:
 *   1. Code resolves to an existing users.ref_code.
 *   2. inviter.telegram_id !== current_user.telegram_id  (no self-refer).
 *   3. current_user.referred_by IS NULL                  (no overwrite).
 *   4. inviter.referred_by !== current_user.telegram_id  (no 1-cycle).
 *   5. Cycle of depth ≤ 5 is rejected.
 *
 * Run with: node --test worker/tests/auth-verify.test.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { captureReferredBy } from '../src/auth-verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  resolve(__dirname, '../migrations/0001_affiliate.sql'),
  'utf8',
);

const NOW = 1_700_000_000;

function createDb() {
  const db = new Database(':memory:');
  db.exec(migrationSql);
  return db;
}

/**
 * Helper: insert a user row with optional referred_by.
 */
function insertUser(db, telegramId, refCode, referredBy = null) {
  db.prepare(`
    INSERT INTO users (telegram_id, ref_code, referred_by, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?)
  `).run(telegramId, refCode, referredBy, NOW, NOW);
}

// ---------------------------------------------------------------------------
// Format validation
// ---------------------------------------------------------------------------

test('start_param not matching ref_<CODE> format is silently skipped', () => {
  const db = createDb();
  insertUser(db, 1, 'ALICE001');
  insertUser(db, 2, 'BOB00001');

  const result = captureReferredBy(db, 2, 'invalid_param', NOW);
  assert.equal(result.captured, false);
  assert.match(result.reason, /format/);

  const row = db.prepare('SELECT referred_by FROM users WHERE telegram_id = 2').get();
  assert.equal(row.referred_by, null);
});

test('start_param with correct prefix but wrong length is rejected', () => {
  const db = createDb();
  insertUser(db, 1, 'ALICE001');
  insertUser(db, 2, 'BOB00001');

  const result = captureReferredBy(db, 2, 'ref_SHORT', NOW);
  assert.equal(result.captured, false);
  assert.match(result.reason, /format/);
});

// ---------------------------------------------------------------------------
// Rule 1 — code resolves to an existing ref_code
// ---------------------------------------------------------------------------

test('Rule 1: unknown ref_code is silently skipped', () => {
  const db = createDb();
  insertUser(db, 2, 'BOB00001');

  // No user has ref_code XXXXXXXX
  const result = captureReferredBy(db, 2, 'ref_XXXXXXXX', NOW);
  assert.equal(result.captured, false);
  assert.match(result.reason, /not found/);

  const row = db.prepare('SELECT referred_by FROM users WHERE telegram_id = 2').get();
  assert.equal(row.referred_by, null);
});

// ---------------------------------------------------------------------------
// Rule 2 — no self-referral
// ---------------------------------------------------------------------------

test('Rule 2: self-referral is rejected', () => {
  const db = createDb();
  insertUser(db, 1, 'ALICE001');

  // Alice tries to use her own ref code
  const result = captureReferredBy(db, 1, 'ref_ALICE001', NOW);
  assert.equal(result.captured, false);
  assert.match(result.reason, /self-referral/);

  const row = db.prepare('SELECT referred_by FROM users WHERE telegram_id = 1').get();
  assert.equal(row.referred_by, null);
});

// ---------------------------------------------------------------------------
// Rule 3 — referred_by is set at most once (no overwrite)
// ---------------------------------------------------------------------------

test('Rule 3: subsequent ref-link visits do not overwrite existing attribution', () => {
  const db = createDb();
  insertUser(db, 1, 'ALICE001');
  insertUser(db, 3, 'CAROL001');
  insertUser(db, 2, 'BOB00001', 1); // Bob already attributed to Alice

  // Bob now arrives via Carol's link — must not overwrite
  const result = captureReferredBy(db, 2, 'ref_CAROL001', NOW);
  assert.equal(result.captured, false);
  assert.match(result.reason, /already set/);

  const row = db.prepare('SELECT referred_by FROM users WHERE telegram_id = 2').get();
  assert.equal(row.referred_by, 1); // still Alice
});

// ---------------------------------------------------------------------------
// Rule 4 — no direct 1-cycle
// ---------------------------------------------------------------------------

test('Rule 4: 1-cycle (A referred B, B tries to refer A) is rejected', () => {
  const db = createDb();
  insertUser(db, 1, 'ALICE001');
  insertUser(db, 2, 'BOB00001', 1); // Bob was referred by Alice

  // Alice now tries to use Bob's ref link — would create A→B→A
  const result = captureReferredBy(db, 1, 'ref_BOB00001', NOW);
  assert.equal(result.captured, false);
  assert.match(result.reason, /cycle/i);

  const row = db.prepare('SELECT referred_by FROM users WHERE telegram_id = 1').get();
  assert.equal(row.referred_by, null);
});

// ---------------------------------------------------------------------------
// Rule 5 — cycle detection up to depth 5
// ---------------------------------------------------------------------------

test('Rule 5: multi-hop cycle within depth 5 is rejected', () => {
  const db = createDb();
  // Chain: A←B←C←D (D was referred by C, C by B, B by A)
  insertUser(db, 1, 'AAAAAAAA');
  insertUser(db, 2, 'BBBBBBBB', 1); // B referred by A
  insertUser(db, 3, 'CCCCCCCC', 2); // C referred by B
  insertUser(db, 4, 'DDDDDDDD', 3); // D referred by C

  // A tries to use D's link — would close the cycle A→B→C→D→A
  const result = captureReferredBy(db, 1, 'ref_DDDDDDDD', NOW);
  assert.equal(result.captured, false);
  assert.match(result.reason, /cycle/i);

  const row = db.prepare('SELECT referred_by FROM users WHERE telegram_id = 1').get();
  assert.equal(row.referred_by, null);
});

test('Rule 5: chain longer than depth 5 is not flagged as a cycle', () => {
  const db = createDb();
  // Chain of 7 users: each referred by the previous
  // user 10 → 11 → 12 → 13 → 14 → 15 → 16
  insertUser(db, 10, 'USER0010');
  insertUser(db, 11, 'USER0011', 10);
  insertUser(db, 12, 'USER0012', 11);
  insertUser(db, 13, 'USER0013', 12);
  insertUser(db, 14, 'USER0014', 13);
  insertUser(db, 15, 'USER0015', 14);
  insertUser(db, 16, 'USER0016', 15);

  // user 10 uses user 16's link — cycle is at depth 6, beyond the guard
  // This should succeed (depth guard is 5; we stop traversal there)
  const result = captureReferredBy(db, 10, 'ref_USER0016', NOW);
  assert.equal(result.captured, true, 'deep chain beyond depth 5 should not be falsely flagged');
});

// ---------------------------------------------------------------------------
// Happy path — successful attribution
// ---------------------------------------------------------------------------

test('happy path: valid first attribution is persisted and audit ledger row written', () => {
  const db = createDb();
  insertUser(db, 1, 'ALICE001');
  insertUser(db, 2, 'BOB00001');

  const result = captureReferredBy(db, 2, 'ref_ALICE001', NOW);
  assert.equal(result.captured, true);

  // referred_by is set
  const user = db.prepare('SELECT referred_by FROM users WHERE telegram_id = 2').get();
  assert.equal(user.referred_by, 1);

  // audit ledger row written with memo='referral_captured:<inviter_id>'
  const ledger = db.prepare(
    "SELECT * FROM point_ledger WHERE user_id = 2 AND role = 'admin_grant'",
  ).get();
  assert.ok(ledger, 'ledger row should exist');
  assert.equal(ledger.delta_points, 0);
  assert.equal(ledger.memo, 'referral_captured:1');
  assert.equal(ledger.created_at, NOW);
});

test('happy path: second call for a user with no referred_by still succeeds', () => {
  const db = createDb();
  insertUser(db, 1, 'ALICE001');
  insertUser(db, 2, 'BOB00001'); // Bob has no referred_by yet

  const first = captureReferredBy(db, 2, 'ref_ALICE001', NOW);
  assert.equal(first.captured, true);

  // A repeat call (e.g. app restarted) must not create duplicate ledger rows
  // because referred_by is now set — Rule 3 kicks in silently
  const second = captureReferredBy(db, 2, 'ref_ALICE001', NOW);
  assert.equal(second.captured, false);
  assert.match(second.reason, /already set/);

  const count = db.prepare(
    "SELECT COUNT(*) AS n FROM point_ledger WHERE user_id = 2 AND role = 'admin_grant'",
  ).get();
  assert.equal(count.n, 1); // exactly one ledger row
});
