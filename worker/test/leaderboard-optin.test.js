/**
 * Unit tests for the /optin HTTP handler in worker/leaderboard.js.
 *
 * Verifies the fix for issue #182:
 *   - rejects requests with no initData (401)
 *   - rejects requests with a tampered HMAC (401)
 *   - rejects requests with stale initData (auth_date older than 24h)
 *   - stores the opt-in flag under the signed user id, ignoring body.userId
 *     (so a caller cannot opt other users in or out)
 *   - deletes the opt-in flag when optIn=false
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { webcrypto } from 'node:crypto';

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto;
}

const { default: leaderboardWorker } = await import('../leaderboard.js');

const BOT_TOKEN = 'test-bot-token-leaderboard';

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

async function buildInitData({ userId = 12345, username = 'alice', authDate, botToken = BOT_TOKEN } = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  const user = JSON.stringify({ id: userId, username });
  const fields = {
    auth_date: String(authDate ?? nowS),
    query_id: 'AAFAKE',
    user,
  };
  const entries = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const dataCheckString = entries.join('\n');

  const secretKey = await hmacSHA256(enc('WebAppData'), botToken);
  const hash = toHex(await hmacSHA256(secretKey, dataCheckString));

  return new URLSearchParams({ ...fields, hash }).toString();
}

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

function makeRequest(initData, body) {
  return new Request('https://worker.example/optin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(initData ? { 'X-Telegram-Init-Data': initData } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('/optin endpoint — HMAC validation (issue #182)', () => {
  it('rejects requests with no X-Telegram-Init-Data header', async () => {
    const kv = makeKv();
    const request = new Request('https://worker.example/optin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: '777', optIn: true }),
    });
    const response = await leaderboardWorker.fetch(request, { BOT_TOKEN, LEADERBOARD_KV: kv });
    assert.equal(response.status, 401);
    assert.equal(kv.store.size, 0);
  });

  it('rejects requests with a tampered HMAC hash', async () => {
    const kv = makeKv();
    const initData = await buildInitData({ userId: 12345 });
    const tampered = initData.replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64));
    const response = await leaderboardWorker.fetch(
      makeRequest(tampered, { userId: '12345', optIn: true }),
      { BOT_TOKEN, LEADERBOARD_KV: kv },
    );
    assert.equal(response.status, 401);
    assert.equal(kv.store.size, 0);
  });

  it('rejects requests signed with a wrong bot token', async () => {
    const kv = makeKv();
    const initData = await buildInitData({ userId: 12345, botToken: 'attacker-token' });
    const response = await leaderboardWorker.fetch(
      makeRequest(initData, { userId: '12345', optIn: true }),
      { BOT_TOKEN, LEADERBOARD_KV: kv },
    );
    assert.equal(response.status, 401);
    assert.equal(kv.store.size, 0);
  });

  it('rejects initData with auth_date older than 24h', async () => {
    const kv = makeKv();
    const staleDate = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
    const initData = await buildInitData({ userId: 12345, authDate: staleDate });
    const response = await leaderboardWorker.fetch(
      makeRequest(initData, { userId: '12345', optIn: true }),
      { BOT_TOKEN, LEADERBOARD_KV: kv },
    );
    assert.equal(response.status, 401);
    assert.equal(kv.store.size, 0);
  });

  it('returns 503 when BOT_TOKEN is not configured', async () => {
    const kv = makeKv();
    const initData = await buildInitData({ userId: 12345 });
    const response = await leaderboardWorker.fetch(
      makeRequest(initData, { optIn: true }),
      { LEADERBOARD_KV: kv },
    );
    assert.equal(response.status, 503);
  });

  it('stores opt-in flag under the signed user id, ignoring body.userId (auth bypass fix)', async () => {
    const kv = makeKv();
    const initData = await buildInitData({ userId: 12345, username: 'alice' });
    const response = await leaderboardWorker.fetch(
      // Attacker tries to opt in user 999 by lying in the body
      makeRequest(initData, { userId: '999', optIn: true }),
      { BOT_TOKEN, LEADERBOARD_KV: kv },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.userId, '12345', 'response userId must come from the signed payload');
    assert.equal(body.optIn, true);
    // KV must store the signed user id, not the body-provided one
    assert.equal(kv.store.get('optin:12345'), '1');
    assert.equal(kv.store.has('optin:999'), false);
  });

  it('deletes the opt-in flag for the signed user when optIn=false', async () => {
    const kv = makeKv();
    kv.store.set('optin:12345', '1');
    kv.store.set('optin:999', '1');
    const initData = await buildInitData({ userId: 12345 });
    const response = await leaderboardWorker.fetch(
      // Attacker tries to opt out user 999 by lying in the body
      makeRequest(initData, { userId: '999', optIn: false }),
      { BOT_TOKEN, LEADERBOARD_KV: kv },
    );
    assert.equal(response.status, 200);
    // Only the signed user's flag is removed; the unrelated entry stays
    assert.equal(kv.store.has('optin:12345'), false);
    assert.equal(kv.store.get('optin:999'), '1');
  });

  it('returns 405 for non-POST methods', async () => {
    const request = new Request('https://worker.example/optin', { method: 'GET' });
    const response = await leaderboardWorker.fetch(request, { BOT_TOKEN, LEADERBOARD_KV: makeKv() });
    assert.equal(response.status, 405);
  });

  it('returns 404 for non-/optin paths', async () => {
    const request = new Request('https://worker.example/other', { method: 'POST' });
    const response = await leaderboardWorker.fetch(request, { BOT_TOKEN, LEADERBOARD_KV: makeKv() });
    assert.equal(response.status, 404);
  });

  it('returns 503 when LEADERBOARD_KV is not configured', async () => {
    const initData = await buildInitData({ userId: 12345 });
    const response = await leaderboardWorker.fetch(
      makeRequest(initData, { optIn: true }),
      { BOT_TOKEN },
    );
    assert.equal(response.status, 503);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const initData = await buildInitData({ userId: 12345 });
    const request = new Request('https://worker.example/optin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
      },
      body: 'not-json',
    });
    const response = await leaderboardWorker.fetch(request, { BOT_TOKEN, LEADERBOARD_KV: makeKv() });
    assert.equal(response.status, 400);
  });
});
