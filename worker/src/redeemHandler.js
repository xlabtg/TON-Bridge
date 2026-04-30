// POST /api/redeem
// Validates the request, inserts a redemptions row + negative ledger entry
// atomically, then attempts TONBANKCARD payout.
// Rate limits: 1 in-flight per user; 5 per day.

import { validateInitData } from './validateInitData.js';

const MIN_REDEEM_POINTS = 100;
const POINTS_PER_TBC    = 10;
const MAX_PER_DAY       = 5;

export async function handleRedeem(request, env) {
    // Parse body
    let body;
    try {
        body = await request.json();
    } catch {
        return jsonError('bad_request', 400);
    }

    const { points_spent, initData } = body;

    // --- Authenticate ---
    let tgUser;
    try {
        tgUser = await validateInitData(initData || '', env.TELEGRAM_BOT_TOKEN || '');
    } catch {
        // In dev/test mode without a real bot token, fall back to initData user field
        if (env.DEV_MODE === 'true' && initData) {
            try {
                const p = new URLSearchParams(initData);
                tgUser = JSON.parse(p.get('user') || '{}');
            } catch {
                return jsonError('unauthorized', 401);
            }
        } else {
            return jsonError('unauthorized', 401);
        }
    }

    const telegram_id = tgUser.id;
    if (!telegram_id) return jsonError('unauthorized', 401);

    // --- Validate points_spent ---
    const pts = parseInt(points_spent, 10);
    if (!Number.isInteger(pts) || pts < MIN_REDEEM_POINTS) {
        return jsonError('min_points', 400);
    }
    if (pts % POINTS_PER_TBC !== 0) {
        return jsonError('not_multiple', 400);
    }

    const db = env.DB;

    // --- Check balance ---
    const balanceRow = await db.prepare(
        'SELECT COALESCE(SUM(delta_points),0) AS pts FROM point_ledger WHERE user_id = ?'
    ).bind(telegram_id).first();
    const balance = balanceRow ? Number(balanceRow.pts) : 0;

    if (pts > balance) return jsonError('low_balance', 400);

    // --- Rate limit: in-flight (requested = awaiting payout, queued = awaiting wallet) ---
    const inflight = await db.prepare(
        "SELECT COUNT(*) AS c FROM redemptions WHERE user_id=? AND status IN ('requested','queued')"
    ).bind(telegram_id).first();
    if (inflight && Number(inflight.c) > 0) return jsonError('in_flight', 429);

    // --- Rate limit: 5 per day ---
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const daily = await db.prepare(
        "SELECT COUNT(*) AS c FROM redemptions WHERE user_id=? AND date(created_at)=?"
    ).bind(telegram_id, today).first();
    if (daily && Number(daily.c) >= MAX_PER_DAY) return jsonError('rate_limit', 429);

    // --- Check ton_address ---
    const userRow = await db.prepare(
        'SELECT ton_address FROM users WHERE telegram_id=?'
    ).bind(telegram_id).first();
    const hasTonAddress = !!(userRow && userRow.ton_address);

    const tbc_amount = Math.floor(pts / POINTS_PER_TBC);
    const initialStatus = hasTonAddress ? 'requested' : 'queued';

    // --- Atomic insert: redemptions row + negative ledger entry ---
    const insertResult = await db.batch([
        db.prepare(
            "INSERT INTO redemptions (user_id, points_spent, tbc_amount, status) VALUES (?,?,?,?)"
        ).bind(telegram_id, pts, tbc_amount, initialStatus),
        db.prepare(
            "INSERT INTO point_ledger (user_id, role, delta_points, memo) VALUES (?,?,?,?)"
        ).bind(telegram_id, 'redemption', -pts, `redeem:${tbc_amount}tbc`)
    ]);

    // Get the new redemption id from the first statement's result
    const redemptionId = insertResult[0].meta && insertResult[0].meta.last_row_id;

    if (!hasTonAddress) {
        return jsonResponse({ ok: true, queued: true, tbc_amount, redemption_id: redemptionId }, 201);
    }

    // --- Attempt TONBANKCARD payout ---
    try {
        await callTonbankcard({
            telegram_id,
            ton_address: userRow.ton_address,
            tbc_amount,
            redemption_id: redemptionId,
        }, env);

        await db.prepare(
            "UPDATE redemptions SET status='paid', settled_at=datetime('now') WHERE id=?"
        ).bind(redemptionId).run();

        return jsonResponse({ ok: true, queued: false, tbc_amount, redemption_id: redemptionId }, 200);
    } catch (err) {
        // Roll back: flip status to failed + insert compensating positive-delta ledger row
        await db.batch([
            db.prepare(
                "UPDATE redemptions SET status='failed', settled_at=datetime('now') WHERE id=?"
            ).bind(redemptionId),
            db.prepare(
                "INSERT INTO point_ledger (user_id, role, delta_points, memo) VALUES (?,?,?,?)"
            ).bind(telegram_id, 'admin_grant', pts, `refund:redemption#${redemptionId}`)
        ]);

        console.error('TONBANKCARD payout failed:', err.message);
        return jsonError('payout_failed', 502);
    }
}

// GET /api/balance
export async function handleBalance(request, env) {
    const url = new URL(request.url);
    const initData = url.searchParams.get('initData') || '';

    let tgUser;
    try {
        tgUser = await validateInitData(initData, env.TELEGRAM_BOT_TOKEN || '');
    } catch {
        if (env.DEV_MODE === 'true' && initData) {
            try {
                const p = new URLSearchParams(initData);
                tgUser = JSON.parse(p.get('user') || '{}');
            } catch {
                return jsonError('unauthorized', 401);
            }
        } else {
            return jsonError('unauthorized', 401);
        }
    }

    const telegram_id = tgUser.id;
    if (!telegram_id) return jsonError('unauthorized', 401);

    const db = env.DB;

    const balanceRow = await db.prepare(
        'SELECT COALESCE(SUM(delta_points),0) AS pts FROM point_ledger WHERE user_id=?'
    ).bind(telegram_id).first();
    const points = balanceRow ? Number(balanceRow.pts) : 0;

    const userRow = await db.prepare(
        'SELECT ton_address FROM users WHERE telegram_id=?'
    ).bind(telegram_id).first();

    const redemptions = await db.prepare(
        'SELECT id, points_spent, tbc_amount, status, created_at FROM redemptions WHERE user_id=? ORDER BY created_at DESC LIMIT 20'
    ).bind(telegram_id).all();

    return jsonResponse({
        points,
        ton_address: userRow ? userRow.ton_address : null,
        redemptions: redemptions.results || [],
    });
}

// Stub for TONBANKCARD API call — replace with real endpoint when available.
async function callTonbankcard({ telegram_id, ton_address, tbc_amount, redemption_id }, env) {
    const apiKey = env.TONBANKCARD_API_KEY;
    if (!apiKey) {
        // When no key is configured, treat as payout-deferred (behave like no ton_address)
        throw new Error('TONBANKCARD_API_KEY not configured');
    }

    const resp = await fetch('https://api.tonbankcard.com/v1/credit', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            recipient_address: ton_address,
            tbc_amount,
            external_ref: `redemption_${redemption_id}_user_${telegram_id}`,
        }),
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`TONBANKCARD HTTP ${resp.status}: ${text}`);
    }
    return resp.json();
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}

function jsonError(error, status) {
    return jsonResponse({ ok: false, error }, status);
}
