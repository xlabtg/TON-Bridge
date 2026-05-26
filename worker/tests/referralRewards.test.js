import Database from 'better-sqlite3';
import { createHmac } from 'node:crypto';
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
    JWT_SECRET: 'unit-test-jwt-secret',
    DEV_MODE: 'true',
    POINTS_PER_TBC: '10',
    ...overrides,
  };
}

function fakeInitData(userId, startParam = '') {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify({ id: userId, first_name: 'Test' }));
  if (startParam) params.set('start_param', startParam);
  return params.toString();
}

function signedInitData(userId, botToken, startParam = '') {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  if (startParam) params.set('start_param', startParam);
  params.set('user', JSON.stringify({ id: userId, first_name: 'Test' }));

  const entries = [];
  for (const [key, value] of params.entries()) {
    entries.push(`${key}=${value}`);
  }
  entries.sort();

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(entries.join('\n')).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function referralRequest(userId, startParam = '') {
  return new Request(
    `https://worker.example.com/api/referral?initData=${encodeURIComponent(fakeInitData(userId, startParam))}`,
    { headers: { Origin: 'http://localhost' } },
  );
}

function authVerifyRequest(initData) {
  return new Request('https://worker.example.com/auth/verify', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initData }),
  });
}

function seedUser(db, telegramId, pointsByRole = {}, referredBy = null) {
  const refCode = `REF${String(telegramId).padStart(5, '0')}`;
  db.prepare(`
    INSERT INTO users (telegram_id, ref_code, referred_by, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?)
  `).run(telegramId, refCode, referredBy, 1, 1);

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
  assert.equal(body.referral_count, 0);
  assert.equal(body.installed_referrals, 0);
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

test('GET /api/referral reuses the same referral code for the same Telegram user', async () => {
  const db = makeDb();

  const first = await worker.fetch(referralRequest(303), makeEnv(db));
  const firstBody = await first.json();
  const second = await worker.fetch(referralRequest(303), makeEnv(db));
  const secondBody = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(secondBody.ref_code, firstBody.ref_code);

  const count = db.prepare('SELECT COUNT(*) AS n FROM users WHERE telegram_id = ?').get(303);
  assert.equal(count.n, 1);
});

test('POST /auth/verify captures referral start_param and counts installed referrals', async () => {
  const botToken = 'unit-test-bot-token';
  const db = makeDb();
  seedUser(db, 301);

  const res = await worker.fetch(
    authVerifyRequest(signedInitData(302, botToken, 'ref_REF00301')),
    makeEnv(db, { BOT_TOKEN: botToken }),
  );
  assert.equal(res.status, 200);

  const referred = db.prepare('SELECT referred_by FROM users WHERE telegram_id = ?').get(302);
  assert.equal(referred.referred_by, 301);

  const inviterRes = await worker.fetch(referralRequest(301), makeEnv(db));
  assert.equal(inviterRes.status, 200);
  const inviterBody = await inviterRes.json();
  assert.equal(inviterBody.referral_count, 1);
  assert.equal(inviterBody.installed_referrals, 1);
});
