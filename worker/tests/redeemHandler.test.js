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
        "INSERT OR IGNORE INTO users (telegram_id, ref_code, ton_address) VALUES (?,?,?)"
    ).run(telegramId, `REF${telegramId}`, ton_address);

    if (points > 0) {
        db.prepare(
            "INSERT INTO point_ledger (user_id, role, delta_points) VALUES (?,?,?)"
        ).run(telegramId, 'admin_grant', points);
    }
}

// ── import the handlers ───────────────────────────────────────────────────────

// We import dynamically so Jest can pick up the ESM module.
const { handleRedeem, handleBalance } = await import('../src/redeemHandler.js');

// ── helpers for building fake Requests ───────────────────────────────────────

function postRequest(body) {
    return new Request('https://worker/api/redeem', {
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
        expect(res.status).toBe(400);
        expect(body.error).toBe('min_points');
    });

    test('rejects points_spent not a multiple of 10', async () => {
        const db = makeDb();
        seedUser(db, 2, 500, { ton_address: 'EQA' });
        const env = makeEnv(db);
        const res = await handleRedeem(postRequest({ points_spent: 105, initData: fakeInitData(2) }), env);
        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.error).toBe('not_multiple');
    });

    test('rejects when points_spent exceeds balance', async () => {
        const db = makeDb();
        seedUser(db, 3, 50, { ton_address: 'EQA' });
        const env = makeEnv(db);
        const res = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(3) }), env);
        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.error).toBe('low_balance');
    });
});

describe('POST /api/redeem — balance bookkeeping', () => {
    test('deducts points on successful submission (queued path)', async () => {
        const db = makeDb();
        seedUser(db, 10, 200); // no ton_address → queued
        const env = makeEnv(db);

        const res = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(10) }), env);
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.queued).toBe(true);
        expect(body.tbc_amount).toBe(10);

        // Balance should be 100 (200 - 100)
        const bal = db.prepare("SELECT SUM(delta_points) AS pts FROM point_ledger WHERE user_id=10").get();
        expect(Number(bal.pts)).toBe(100);
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

        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toBe('payout_failed');

        // Balance should be restored to 200
        const bal = db.prepare("SELECT SUM(delta_points) AS pts FROM point_ledger WHERE user_id=11").get();
        expect(Number(bal.pts)).toBe(200);

        // Redemption status should be 'failed'
        const red = db.prepare("SELECT status FROM redemptions WHERE user_id=11").get();
        expect(red.status).toBe('failed');
    });
});

describe('POST /api/redeem — idempotency & rate limiting', () => {
    test('blocks a second in-flight redemption', async () => {
        const db = makeDb();
        seedUser(db, 20, 500); // no ton_address → first goes queued/requested
        const env = makeEnv(db);

        // First request succeeds (queued)
        const r1 = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(20) }), env);
        expect(r1.status).toBe(201);

        // Second request should be blocked
        const r2 = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(20) }), env);
        const b2 = await r2.json();
        expect(r2.status).toBe(429);
        expect(b2.error).toBe('in_flight');
    });

    test('enforces 5 per-day rate limit', async () => {
        const db = makeDb();
        seedUser(db, 30, 1000, { ton_address: null }); // queued path so in-flight check clears via status change
        const env = makeEnv(db);

        // Manually seed 5 redemptions for today with status='paid' (not in-flight)
        const today = new Date().toISOString().slice(0, 10);
        for (let i = 0; i < 5; i++) {
            db.prepare(
                "INSERT INTO redemptions (user_id, points_spent, tbc_amount, status, created_at) VALUES (30,100,10,'paid',?)"
            ).run(`${today}T00:0${i}:00`);
        }

        const res = await handleRedeem(postRequest({ points_spent: 100, initData: fakeInitData(30) }), env);
        const body = await res.json();
        expect(res.status).toBe(429);
        expect(body.error).toBe('rate_limit');
    });
});

describe('GET /api/balance', () => {
    test('returns correct balance and empty redemptions', async () => {
        const db = makeDb();
        seedUser(db, 40, 350);
        const env = makeEnv(db);

        const res = await handleBalance(getBalanceRequest(40), env);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.points).toBe(350);
        expect(body.ton_address).toBeNull();
        expect(body.redemptions).toHaveLength(0);
    });

    test('returns redemption history', async () => {
        const db = makeDb();
        seedUser(db, 41, 500, { ton_address: 'EQA' });
        db.prepare(
            "INSERT INTO redemptions (user_id,points_spent,tbc_amount,status) VALUES (41,100,10,'paid')"
        ).run();
        const env = makeEnv(db);

        const res = await handleBalance(getBalanceRequest(41), env);
        const body = await res.json();
        expect(body.redemptions).toHaveLength(1);
        expect(body.redemptions[0].status).toBe('paid');
    });
});
