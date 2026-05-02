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
const { validateInitData } = await import('../src/index.js');

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
