/**
 * Unit tests for HMAC initData validation.
 *
 * Uses Node's built-in `crypto.subtle` (available since Node 18) to pre-compute
 * a valid fixture so the tests do not depend on Cloudflare-specific globals.
 *
 * Run: npm test  (inside the worker/ directory)
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { webcrypto } from 'node:crypto';

// Polyfill Web Crypto for the module under test (Node 18 global is `crypto`
// but some environments expose it differently).
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto;
}

// Dynamically import after the polyfill is in place.
const {
  buildReferralShareUrl,
  generateRefCode,
  validateInitData,
  default: worker,
} = await import('../src/index.js');

// ──────────────────────────────────────────────────────────────────────────────
// Fixture generator
// ──────────────────────────────────────────────────────────────────────────────

const BOT_TOKEN = 'test-bot-token-123';

function enc(str) {
  return new TextEncoder().encode(str);
}

async function hmacSHA256(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc(data));
  return new Uint8Array(sig);
}

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function buildValidInitData(overrides = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: 12345, username: 'alice', language_code: 'en' });

  const fields = {
    auth_date: String(overrides.auth_date ?? nowS),
    query_id: overrides.query_id ?? 'AAFAKE',
    user: overrides.user ?? user,
  };

  const entries = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const dataCheckString = entries.join('\n');

  const secretKey = await hmacSHA256(enc('WebAppData'), BOT_TOKEN);
  const hash = toHex(await hmacSHA256(secretKey, dataCheckString));

  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('validateInitData', () => {
  it('accepts a valid initData payload', async () => {
    const initData = await buildValidInitData();
    const result = await validateInitData(initData, BOT_TOKEN);
    assert.equal(result.user.id, 12345);
    assert.equal(result.user.username, 'alice');
    assert.equal(result.user.language_code, 'en');
  });

  it('rejects initData with a tampered hash', async () => {
    const initData = await buildValidInitData();
    const tampered = initData.replace(/hash=[0-9a-f]+/, 'hash=deadbeef00000000deadbeef00000000deadbeef00000000deadbeef00000000');
    await assert.rejects(() => validateInitData(tampered, BOT_TOKEN), /invalid hash/);
  });

  it('rejects initData signed with a wrong bot token', async () => {
    const initData = await buildValidInitData();
    await assert.rejects(() => validateInitData(initData, 'wrong-token'), /invalid hash/);
  });

  it('rejects initData missing the hash field', async () => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: '{}' });
    await assert.rejects(() => validateInitData(params.toString(), BOT_TOKEN), /missing hash/);
  });

  it('rejects initData with auth_date older than 24 h', async () => {
    const staleDate = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
    const initData = await buildValidInitData({ auth_date: staleDate });
    await assert.rejects(() => validateInitData(initData, BOT_TOKEN), /expired/);
  });

  it('rejects initData missing auth_date', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const user = JSON.stringify({ id: 1 });

    // Build without auth_date
    const fields = { query_id: 'X', user };
    const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
    const secretKey = await hmacSHA256(enc('WebAppData'), BOT_TOKEN);
    const hash = toHex(await hmacSHA256(secretKey, entries.join('\n')));

    const params = new URLSearchParams({ ...fields, hash });
    await assert.rejects(() => validateInitData(params.toString(), BOT_TOKEN), /missing auth_date/);
  });

  it('handles initData without a user field gracefully', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const fields = { auth_date: String(nowS), query_id: 'Y' };
    const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
    const secretKey = await hmacSHA256(enc('WebAppData'), BOT_TOKEN);
    const hash = toHex(await hmacSHA256(secretKey, entries.join('\n')));
    const params = new URLSearchParams({ ...fields, hash });

    const result = await validateInitData(params.toString(), BOT_TOKEN);
    assert.equal(result.user, null);
  });
});

describe('/auth/verify referral issuance', () => {
  function createMockDb(existingRows = new Map()) {
    const rows = new Map(existingRows);
    const inserts = [];
    const updates = [];

    return {
      rows,
      inserts,
      updates,
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                const telegramId = Number(args[0]);
                return rows.get(telegramId) || null;
              },
              async run() {
                if (/^UPDATE users SET last_seen/i.test(sql)) {
                  updates.push({ lastSeen: args[0], telegramId: Number(args[1]) });
                  return { success: true };
                }

                if (/^INSERT INTO users/i.test(sql)) {
                  const [telegramId, refCode, createdAt, lastSeen] = args;
                  for (const row of rows.values()) {
                    if (row.ref_code === refCode) {
                      throw new Error('UNIQUE constraint failed: users.ref_code');
                    }
                  }

                  const row = {
                    telegram_id: Number(telegramId),
                    ref_code: refCode,
                    referred_by: null,
                    ton_address: null,
                    created_at: createdAt,
                    last_seen: lastSeen,
                  };
                  rows.set(Number(telegramId), row);
                  inserts.push(row);
                  return { success: true };
                }

                throw new Error(`unexpected SQL: ${sql}`);
              },
            };
          },
        };
      },
    };
  }

  async function verifyWithDb(db, initData) {
    const request = new Request('https://worker.example/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });

    return worker.fetch(request, {
      BOT_TOKEN,
      JWT_SECRET: 'test-jwt-secret-that-is-long-enough',
      DB: db,
    });
  }

  it('generateRefCode returns 8 chars from the unambiguous alphabet', () => {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 100; i += 1) {
      const code = generateRefCode();
      assert.equal(code.length, 8);
      assert.match(code, /^[A-Z2-9]+$/);
      assert.equal([...code].every(ch => alphabet.includes(ch)), true);
      assert.doesNotMatch(code, /[01OIL]/);
    }
  });

  it('creates a users row and returns ref_code plus canonical share URL', async () => {
    const db = createMockDb();
    const initData = await buildValidInitData({ user: JSON.stringify({ id: 777, username: 'carol' }) });
    const response = await verifyWithDb(db, initData);

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(db.inserts.length, 1);
    assert.equal(body.user.ref_code, db.inserts[0].ref_code);
    assert.equal(body.user.ref_share_url, buildReferralShareUrl(body.user.ref_code));
    assert.match(body.user.ref_share_url, /^https:\/\/t\.me\/TONBridge_robot\/app\?startapp=ref_[A-Z2-9]{8}$/);
  });

  it('reuses an existing user ref_code and updates last_seen', async () => {
    const db = createMockDb(new Map([
      [888, { telegram_id: 888, ref_code: 'ABCD2345', referred_by: null, ton_address: null }],
    ]));
    const initData = await buildValidInitData({ user: JSON.stringify({ id: 888, username: 'dave' }) });
    const response = await verifyWithDb(db, initData);

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.ref_code, 'ABCD2345');
    assert.equal(db.inserts.length, 0);
    assert.equal(db.updates.length, 1);
  });

  it('regenerates the ref_code on a DB uniqueness collision', async () => {
    const db = createMockDb(new Map([
      [1, { telegram_id: 1, ref_code: 'AAAAAAAA', referred_by: null, ton_address: null }],
    ]));
    const originalRandomValues = crypto.getRandomValues.bind(crypto);
    let call = 0;

    crypto.getRandomValues = (bytes) => {
      const fill = call === 0 ? 0 : 1;
      bytes.fill(fill);
      call += 1;
      return bytes;
    };

    try {
      const initData = await buildValidInitData({ user: JSON.stringify({ id: 999, username: 'erin' }) });
      const response = await verifyWithDb(db, initData);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.user.ref_code, 'BBBBBBBB');
      assert.equal(call, 2);
    } finally {
      crypto.getRandomValues = originalRandomValues;
    }
  });
});
