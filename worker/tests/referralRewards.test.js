import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeDb() {
  const db = new Database(':memory:');
  const sql = readFileSync(join(__dirname, '../migrations/0001_affiliate.sql'), 'utf8');
  db.exec(sql);
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
      const results = stmts.map((s) => {
        const result = s._stmt().run(...s._args());
        return { meta: { last_row_id: result.lastInsertRowid } };
      });
      return Promise.resolve(results);
    },
  };
}

function makeEnv(db, overrides = {}) {
  return {
    DB: wrapD1(db),
    BOT_TOKEN: '',
    TELEGRAM_BOT_TOKEN: '',
    DEV_MODE: 'true',
    POINTS_PER_TBC: '10',
    ...overrides,
  };
}

function fakeInitData(userId) {
  return `user=${encodeURIComponent(JSON.stringify({ id: userId, first_name: 'Test' }))}`;
}

function referralRequest(userId) {
  return new Request(
    `https://worker.example.com/api/referral?initData=${encodeURIComponent(fakeInitData(userId))}`,
    { headers: { Origin: 'http://localhost' } },
  );
}

function seedUser(db, telegramId, pointsByRole = {}) {
  const refCode = `REF${String(telegramId).padStart(5, '0')}`;
  db.prepare(`
    INSERT INTO users (telegram_id, ref_code, created_at, last_seen)
    VALUES (?, ?, ?, ?)
  `).run(telegramId, refCode, 1, 1);

  for (const [role, points] of Object.entries(pointsByRole)) {
    db.prepare(`
      INSERT INTO point_ledger (user_id, role, delta_points, created_at)
      VALUES (?, ?, ?, ?)
    `).run(telegramId, role, points, 1);
  }
}

test('GET /api/referral returns TBC reward balance from the points ledger', async () => {
  const db = makeDb();
  seedUser(db, 101, {
    referrer: 770,
    trader: 20,
    redemption: -100,
  });

  const res = await worker.fetch(referralRequest(101), makeEnv(db));
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.ref_code, 'REF00101');
  assert.equal(body.ref_share_url, 'https://t.me/TONBridge_robot/app?startapp=ref_REF00101');
  assert.equal(body.points_per_tbc, 10);
  assert.equal(body.pending_points, 690);
  assert.equal(body.pending_tbc, 69);
  assert.equal(body.referral_points, 770);
  assert.equal(body.referral_tbc, 77);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'pending_stars'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'stars_disabled'), false);
});

test('GET /api/referral creates a referral code for a new Telegram user', async () => {
  const db = makeDb();
  const res = await worker.fetch(referralRequest(202), makeEnv(db));
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.ref_code, /^[A-Z2-9]{8}$/);
  assert.equal(body.pending_points, 0);
  assert.equal(body.pending_tbc, 0);

  const user = db.prepare('SELECT telegram_id, ref_code FROM users WHERE telegram_id = ?').get(202);
  assert.equal(user.telegram_id, 202);
  assert.equal(user.ref_code, body.ref_code);
});
