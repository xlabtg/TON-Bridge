/**
 * Unit tests for redeemHandler.js
 *
 * Uses better-sqlite3 as an in-process D1 substitute so we can run without a
 * real Cloudflare deployment.  The DB mock exposes the same `.prepare().bind()
 * .first()` / `.all()` / `.run()` / `.batch()` surface used by the handler.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDb() {
    const db = new Database(':memory:');
    const sql = readFileSync(join(__dirname, '../migrations/0001_affiliate.sql'), 'utf8');
    db.exec(sql);
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
            // Store the bound state for batch()
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

/** Build a minimal env object. */
function makeEnv(db, overrides = {}) {
    return {
        DB: wrapD1(db),
        TELEGRAM_BOT_TOKEN: '',
        DEV_MODE: 'true',
        TONBANKCARD_API_KEY: '',
        ...overrides,
    };
}

/** Build fake initData for DEV_MODE (skip HMAC). */
function fakeInitData(userId) {
    return `user=${encodeURIComponent(JSON.stringify({ id: userId, first_name: 'Test' }))}`;
}

/** Seed a user row and a point_ledger credit. */
function seedUser(db, telegramId, points, { ton_address = null } = {}) {
    db.prepare(
        "INSERT OR IGNORE INTO users (telegram_id, ref_code, ton_address, created_at, last_seen) VALUES (?,?,?,?,?)"
    ).run(telegramId, `REF${telegramId}`, ton_address, 1, 1);

    if (points > 0) {
        db.prepare(
            "INSERT INTO point_ledger (user_id, role, delta_points, created_at) VALUES (?,?,?,?)"
        ).run(telegramId, 'admin_grant', points, 1);
    }
}

// ── import the handlers ───────────────────────────────────────────────────────

// We import dynamically so Jest can pick up the ESM module.
const { handleRedeem, handleBalance, handleWalletLink } = await import('../src/redeemHandler.js');

// ── helpers for building fake Requests ───────────────────────────────────────

function postRequest(body) {
    return new Request('https://worker/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function postWalletRequest(body) {
    return new Request('https://worker/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function getBalanceRequest(userId) {
    return new Request(
        `https://worker/api/balance?initData=${encodeURIComponent(fakeInitData(userId))}`
    );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/redeem — validation', () => {
    test('rejects points_spent below minimum (100)', async () => {
        const db = makeDb();
        seedUser(db, 1, 500, { ton_address: 'EQA' });
        const env = makeEnv(db);
        const res = await handleRedeem(postRequest({ points_spent: 50, initData: fakeInitData(1) }), env);
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error, 'min_points');
    });

    test('rejects points_spent not a multiple of 10', async () => {
        const db = makeDb();
        seedUser(db, 2, 500, { ton_address: 'EQA' });
        const env = makeEnv(db);
        const res = await handleRedeem(postRequest({ points_spent: 105, initData: fakeInitData(2) }), env);
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error, 'not_multiple');
    });

    test('rejects when points_spent exceeds balance', async () => {
        const db = makeDb();
        seedUser(db, 3, 50, { ton_address: 'EQA' });
        const env = makeEnv(db);
        const res = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(3) }), env);
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error, 'low_balance');
    });
});

describe('POST /api/redeem — balance bookkeeping', () => {
    test('deducts points on successful submission (queued path)', async () => {
        const db = makeDb();
        seedUser(db, 10, 200); // no ton_address → queued
        const env = makeEnv(db);

        const res = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(10) }), env);
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.queued, true);
        assert.equal(body.tbc_amount, 10);

        // Balance should be 100 (200 - 100)
        const bal = db.prepare("SELECT SUM(delta_points) AS pts FROM point_ledger WHERE user_id=10").get();
        assert.equal(Number(bal.pts), 100);
    });

    test('refunds points on payout failure', async () => {
        const db = makeDb();
        seedUser(db, 11, 200, { ton_address: 'EQA' });
        // Provide a bad API key so callTonbankcard throws
        const env = makeEnv(db, { TONBANKCARD_API_KEY: 'bad_key' });

        // We need to mock global fetch to simulate a payout failure
        const origFetch = global.fetch;
        global.fetch = async () => new Response('error', { status: 500 });

        const res = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(11) }), env);

        global.fetch = origFetch;

        assert.equal(res.status, 502);
        const body = await res.json();
        assert.equal(body.error, 'payout_failed');

        // Balance should be restored to 200
        const bal = db.prepare("SELECT SUM(delta_points) AS pts FROM point_ledger WHERE user_id=11").get();
        assert.equal(Number(bal.pts), 200);

        // Redemption status should be 'failed'
        const red = db.prepare("SELECT status FROM redemptions WHERE user_id=11").get();
        assert.equal(red.status, 'failed');
    });
});

describe('POST /api/redeem — idempotency & rate limiting', () => {
    test('blocks a second in-flight redemption', async () => {
        const db = makeDb();
        seedUser(db, 20, 500); // no ton_address → first goes queued/requested
        const env = makeEnv(db);

        // First request succeeds (queued)
        const r1 = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(20) }), env);
        assert.equal(r1.status, 201);

        // Second request should be blocked
        const r2 = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(20) }), env);
        const b2 = await r2.json();
        assert.equal(r2.status, 429);
        assert.equal(b2.error, 'in_flight');
    });

    test('enforces 5 per-day rate limit', async () => {
        const db = makeDb();
        seedUser(db, 30, 1000, { ton_address: null }); // queued path so in-flight check clears via status change
        const env = makeEnv(db);

        // Manually seed 5 redemptions for today with status='paid' (not in-flight)
        const nowS = Math.floor(Date.now() / 1000);
        const dayStartS = nowS - (nowS % (24 * 60 * 60));
        for (let i = 0; i < 5; i++) {
            db.prepare(
                "INSERT INTO redemptions (user_id, points_spent, tbc_amount, status, created_at) VALUES (30,100,10,'paid',?)"
            ).run(dayStartS + i);
        }

        const res = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(30) }), env);
        const body = await res.json();
        assert.equal(res.status, 429);
        assert.equal(body.error, 'rate_limit');
    });
});

describe('POST /api/wallet', () => {
    test('stores payout TON address for the authenticated Telegram user', async () => {
        const db = makeDb();
        seedUser(db, 35, 0);
        const env = makeEnv(db);
        const tonAddress = 'EQD1234567890ABCDEFABCDEF1234567890ABCDEF1234A';

        const res = await handleWalletLink(postWalletRequest({
            initData: fakeInitData(35),
            ton_address: tonAddress,
        }), env);

        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.ton_address, tonAddress);

        const row = db.prepare('SELECT ton_address FROM users WHERE telegram_id = 35').get();
        assert.equal(row.ton_address, tonAddress);

        const balanceRes = await handleBalance(getBalanceRequest(35), env);
        const balanceBody = await balanceRes.json();
        assert.equal(balanceBody.ton_address, tonAddress);
    });
});

describe('GET /api/balance', () => {
    test('returns correct balance and empty redemptions', async () => {
        const db = makeDb();
        seedUser(db, 40, 350);
        const env = makeEnv(db);

        const res = await handleBalance(getBalanceRequest(40), env);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.points, 350);
        assert.equal(body.ton_address, null);
        assert.equal(body.redemptions.length, 0);
    });

    test('returns redemption history', async () => {
        const db = makeDb();
        seedUser(db, 41, 500, { ton_address: 'EQA' });
        db.prepare(
            "INSERT INTO redemptions (user_id,points_spent,tbc_amount,status,created_at) VALUES (41,100,10,'paid',?)"
        ).run(1);
        const env = makeEnv(db);

        const res = await handleBalance(getBalanceRequest(41), env);
        const body = await res.json();
        assert.equal(body.redemptions.length, 1);
        assert.equal(body.redemptions[0].status, 'paid');
    });
});
