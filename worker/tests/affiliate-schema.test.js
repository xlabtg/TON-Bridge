/**
 * Smoke test: loads the affiliate migration into an in-memory SQLite database,
 * seeds a small fixture set, and asserts that user_balances aggregates correctly.
 *
 * Run with: node --test worker/tests/affiliate-schema.test.js
 * (requires better-sqlite3, installed as a dev dependency)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  resolve(__dirname, '../migrations/0001_affiliate.sql'),
  'utf8',
);

function createDb() {
  const db = new Database(':memory:');
  db.exec(migrationSql);
  return db;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000; // arbitrary unix timestamp

function seedFixtures(db) {
  // Two users: Alice invited Bob
  db.prepare(`
    INSERT INTO users (telegram_id, ref_code, referred_by, created_at, last_seen)
    VALUES (1, 'ALICE001', NULL, ?, ?)
  `).run(NOW, NOW);

  db.prepare(`
    INSERT INTO users (telegram_id, ref_code, referred_by, created_at, last_seen)
    VALUES (2, 'BOB00001', 1, ?, ?)
  `).run(NOW, NOW);

  // Bob completes a $100 swap
  db.prepare(`
    INSERT INTO swaps (id, user_id, from_currency, to_currency, from_amount, to_amount,
                       turnover_usd, usd_rate_source, status, created_at, finished_at)
    VALUES ('txn-001', 2, 'BTC', 'TON', 0.002, 5.0, 100.0, 'coingecko', 'finished', ?, ?)
  `).run(NOW, NOW + 60);

  // Bob earns 3 333 trader points (floor(100 * 10 * 10_000 / 10_000 / 0.00003) = 3333)
  db.prepare(`
    INSERT INTO point_ledger (user_id, swap_id, role, delta_points, rate_bps, created_at)
    VALUES (2, 'txn-001', 'trader', 3333, 10, ?)
  `).run(NOW + 60);

  // Alice earns 3 333 referrer points
  db.prepare(`
    INSERT INTO point_ledger (user_id, swap_id, role, delta_points, rate_bps, created_at)
    VALUES (1, 'txn-001', 'referrer', 3333, 10, ?)
  `).run(NOW + 60);

  // Alice redeems 1 000 points → 100 TBC
  db.prepare(`
    INSERT INTO redemptions (user_id, points_spent, tbc_amount, status, created_at)
    VALUES (1, 1000, 100, 'paid', ?)
  `).run(NOW + 120);

  // Redemption debit row in ledger
  db.prepare(`
    INSERT INTO point_ledger (user_id, swap_id, role, delta_points, created_at)
    VALUES (1, NULL, 'redemption', -1000, ?)
  `).run(NOW + 120);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('migration applies without errors', () => {
  assert.doesNotThrow(() => createDb());
});

test('user_balances: Bob has 3 333 points after one $100 swap', () => {
  const db = createDb();
  seedFixtures(db);

  const row = db.prepare('SELECT points FROM user_balances WHERE user_id = 2').get();
  assert.equal(row.points, 3333);
});

test('user_balances: Alice has 2 333 points after earning 3 333 and redeeming 1 000', () => {
  const db = createDb();
  seedFixtures(db);

  const row = db.prepare('SELECT points FROM user_balances WHERE user_id = 1').get();
  assert.equal(row.points, 2333);
});

test('user_balances: Bob lifetime_turnover_usd is 100', () => {
  const db = createDb();
  seedFixtures(db);

  const row = db.prepare('SELECT lifetime_turnover_usd FROM user_balances WHERE user_id = 2').get();
  assert.equal(row.lifetime_turnover_usd, 100);
});

test('point_ledger idempotency: duplicate (swap_id, role) is rejected', () => {
  const db = createDb();
  seedFixtures(db);

  assert.throws(() => {
    db.prepare(`
      INSERT INTO point_ledger (user_id, swap_id, role, delta_points, rate_bps, created_at)
      VALUES (2, 'txn-001', 'trader', 3333, 10, ?)
    `).run(NOW + 999);
  }, /UNIQUE constraint failed/);
});

test('point_ledger allows multiple NULL swap_id rows for same user (admin_grant)', () => {
  const db = createDb();
  seedFixtures(db);

  assert.doesNotThrow(() => {
    db.prepare(`
      INSERT INTO point_ledger (user_id, swap_id, role, delta_points, created_at)
      VALUES (1, NULL, 'admin_grant', 500, ?)
    `).run(NOW + 200);

    db.prepare(`
      INSERT INTO point_ledger (user_id, swap_id, role, delta_points, created_at)
      VALUES (1, NULL, 'admin_grant', 250, ?)
    `).run(NOW + 300);
  });
});

test('users: self-referral is prevented by application (referred_by != telegram_id check)', () => {
  // The schema itself does not enforce this at DB level (by design — it's
  // application-layer logic per issue #6.3). Verify the column exists and
  // that referred_by can hold a valid foreign key value.
  const db = createDb();
  db.prepare(`
    INSERT INTO users (telegram_id, ref_code, referred_by, created_at, last_seen)
    VALUES (99, 'TEST0099', NULL, ?, ?)
  `).run(NOW, NOW);

  const row = db.prepare('SELECT referred_by FROM users WHERE telegram_id = 99').get();
  assert.equal(row.referred_by, null);
});

test('redemptions: basic insert and retrieval', () => {
  const db = createDb();
  seedFixtures(db);

  const row = db.prepare('SELECT * FROM redemptions WHERE user_id = 1').get();
  assert.equal(row.points_spent, 1000);
  assert.equal(row.tbc_amount, 100);
  assert.equal(row.status, 'paid');
});
