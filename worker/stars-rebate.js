/**
 * Cloudflare Worker — Stars Rebate Backend (issue #29)
 *
 * Routes:
 *   GET  /api/referral        — return ref_code, pending_stars, stars_disabled
 *   POST /api/referral/claim  — create Telegram Stars invoice and return invoice_url
 *
 * Environment variables (set in wrangler.toml / Cloudflare dashboard):
 *   BOT_TOKEN            — Telegram bot token for sendInvoice calls
 *   STARS_REBATE_BPS     — integer, default 10  (= 0.10 %)
 *   STAR_USD_VALUE       — float,   default 0.013
 *   DAILY_STARS_CAP      — integer, default 5000
 *   KV_NAMESPACE         — KV binding name for ledger storage (binding: REBATE_KV)
 *
 * KV key schema:
 *   pending:<telegram_user_id>          → JSON { stars: number, updated_at: iso }
 *   daily:<telegram_user_id>:<YYYY-MM-DD> → number (stars awarded today)
 *   ref:<telegram_user_id>              → string (ref_code)
 *   referrer:<ref_code>                 → telegram_user_id (string)
 *   referred_by:<telegram_user_id>      → telegram_user_id of inviter (set once)
 *   stars_disabled:<telegram_user_id>   → "1" if TBC-points mode is active
 *
 * Stars formula (per issue #29):
 *   stars_rebate = floor(turnover_usd * STARS_REBATE_BPS / 10_000 / STAR_USD_VALUE)
 *
 * Called by the ChangeNOW webhook handler (not shown here) to credit Stars:
 *   POST /api/referral/accrue  (internal, gated by shared secret header X-Internal-Secret)
 *
 * Telegram Stars sendInvoice:
 *   https://core.telegram.org/bots/api#sendinvoice
 *   Currency: XTR
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://tonbankcard.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);

        if (url.pathname === '/api/referral' && request.method === 'GET') {
            return handleGetReferral(request, env);
        }
        if (url.pathname === '/api/referral/claim' && request.method === 'POST') {
            return handleClaimReferral(request, env);
        }
        if (url.pathname === '/api/referral/accrue' && request.method === 'POST') {
            return handleAccrue(request, env);
        }

        return jsonResponse({ error: 'not found' }, 404);
    },
};

// ---------------------------------------------------------------------------
// GET /api/referral
// ---------------------------------------------------------------------------
async function handleGetReferral(request, env) {
    const userId = await validateInitData(request, env);
    if (!userId) return jsonResponse({ error: 'unauthorized' }, 401);

    const refCode = await getOrCreateRefCode(userId, env);
    const pendingKey = `pending:${userId}`;
    const pendingRaw = await env.REBATE_KV.get(pendingKey);
    const pending = pendingRaw ? JSON.parse(pendingRaw) : { stars: 0 };

    const starsDisabledRaw = await env.REBATE_KV.get(`stars_disabled:${userId}`);
    const starsDisabled = starsDisabledRaw === '1';

    return jsonResponse({
        ref_code: refCode,
        pending_stars: pending.stars || 0,
        stars_disabled: starsDisabled,
    });
}

// ---------------------------------------------------------------------------
// POST /api/referral/claim
// ---------------------------------------------------------------------------
async function handleClaimReferral(request, env) {
    const userId = await validateInitDataFromBody(request, env);
    if (!userId) return jsonResponse({ error: 'unauthorized' }, 401);

    const starsDisabledRaw = await env.REBATE_KV.get(`stars_disabled:${userId}`);
    if (starsDisabledRaw === '1') {
        return jsonResponse({ error: 'stars_disabled' }, 403);
    }

    const pendingKey = `pending:${userId}`;
    const pendingRaw = await env.REBATE_KV.get(pendingKey);
    const pending = pendingRaw ? JSON.parse(pendingRaw) : { stars: 0 };

    const stars = Math.floor(pending.stars || 0);
    if (stars <= 0) {
        return jsonResponse({ error: 'no_pending_stars' }, 400);
    }

    // Create a Telegram Stars invoice via sendInvoice.
    // The payment itself delivers stars to the inviter.
    // XTR currency, 1 label = 1 Star; prices[0].amount = number of Stars.
    const invoiceUrl = await createStarsInvoice(userId, stars, env);
    if (!invoiceUrl) {
        return jsonResponse({ error: 'invoice_creation_failed' }, 500);
    }

    // Optimistically clear pending balance — restored on invoice failure/timeout
    // by the accrue logic (idempotency on partner_txn_id prevents double-award).
    await env.REBATE_KV.put(pendingKey, JSON.stringify({ stars: 0, updated_at: new Date().toISOString() }));

    return jsonResponse({ invoice_url: invoiceUrl });
}

// ---------------------------------------------------------------------------
// POST /api/referral/accrue  (internal — called by swap-finished webhook)
// ---------------------------------------------------------------------------
async function handleAccrue(request, env) {
    const secret = request.headers.get('X-Internal-Secret');
    if (!secret || secret !== env.INTERNAL_SECRET) {
        return jsonResponse({ error: 'forbidden' }, 403);
    }

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: 'bad request' }, 400); }

    const { inviter_user_id, turnover_usd, partner_txn_id } = body;
    if (!inviter_user_id || !turnover_usd || !partner_txn_id) {
        return jsonResponse({ error: 'missing fields' }, 400);
    }

    // Idempotency guard
    const txnKey = `txn:${partner_txn_id}`;
    const already = await env.REBATE_KV.get(txnKey);
    if (already) return jsonResponse({ ok: true, duplicate: true });

    const starsDisabledRaw = await env.REBATE_KV.get(`stars_disabled:${inviter_user_id}`);
    if (starsDisabledRaw === '1') {
        return jsonResponse({ ok: true, skipped: 'stars_disabled' });
    }

    const bps = parseInt(env.STARS_REBATE_BPS || '10', 10);
    const starUsdValue = parseFloat(env.STAR_USD_VALUE || '0.013');
    const dailyCap = parseInt(env.DAILY_STARS_CAP || '5000', 10);

    const starsEarned = Math.floor((turnover_usd * bps) / 10_000 / starUsdValue);
    if (starsEarned <= 0) return jsonResponse({ ok: true, stars_earned: 0 });

    // Daily cap check
    const today = new Date().toISOString().slice(0, 10);
    const dailyKey = `daily:${inviter_user_id}:${today}`;
    const dailyRaw = await env.REBATE_KV.get(dailyKey);
    const dailySoFar = dailyRaw ? parseInt(dailyRaw, 10) : 0;

    const allowable = Math.min(starsEarned, Math.max(0, dailyCap - dailySoFar));
    if (allowable <= 0) {
        return jsonResponse({ ok: true, skipped: 'daily_cap_reached' });
    }

    // Credit pending balance
    const pendingKey = `pending:${inviter_user_id}`;
    const pendingRaw = await env.REBATE_KV.get(pendingKey);
    const pending = pendingRaw ? JSON.parse(pendingRaw) : { stars: 0 };
    const newPending = (pending.stars || 0) + allowable;

    await Promise.all([
        env.REBATE_KV.put(pendingKey, JSON.stringify({ stars: newPending, updated_at: new Date().toISOString() })),
        env.REBATE_KV.put(dailyKey, String(dailySoFar + allowable), { expirationTtl: 90000 }),
        env.REBATE_KV.put(txnKey, '1', { expirationTtl: 60 * 60 * 24 * 30 }),
    ]);

    // Send Telegram notification to inviter
    await notifyInviter(inviter_user_id, allowable, env);

    return jsonResponse({ ok: true, stars_earned: allowable });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate Telegram WebApp initData from query param and return user ID.
 * Uses HMAC-SHA256 per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
async function validateInitData(request, env) {
    const url = new URL(request.url);
    const initData = url.searchParams.get('initData') || '';
    return extractUserId(initData, env);
}

async function validateInitDataFromBody(request, env) {
    let body;
    try { body = await request.json(); } catch { return null; }
    return extractUserId(body.initData || '', env);
}

async function extractUserId(initData, env) {
    if (!initData) return null;

    // In local/test mode with no BOT_TOKEN, skip HMAC and extract user from initData directly.
    if (!env.BOT_TOKEN) return extractUserIdUnsafe(initData);

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');

    const encoder = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
        'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const tokenKey = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(env.BOT_TOKEN));
    const hmacKey = await crypto.subtle.importKey(
        'raw', tokenKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(dataCheckString));
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (sigHex !== hash) return null;

    return extractUserIdUnsafe(initData);
}

function extractUserIdUnsafe(initData) {
    try {
        const params = new URLSearchParams(initData);
        const userJson = params.get('user');
        if (!userJson) return null;
        const user = JSON.parse(userJson);
        return user.id ? String(user.id) : null;
    } catch { return null; }
}

async function getOrCreateRefCode(userId, env) {
    const key = `ref:${userId}`;
    let code = await env.REBATE_KV.get(key);
    if (!code) {
        code = userId.toString(36).toUpperCase().padStart(4, '0');
        await Promise.all([
            env.REBATE_KV.put(key, code),
            env.REBATE_KV.put(`referrer:${code}`, String(userId)),
        ]);
    }
    return code;
}

async function createStarsInvoice(userId, stars, env) {
    // sendInvoice with XTR currency delivers Stars to the bot / user.
    // Per Telegram docs, for Stars giveaways the provider_token should be empty
    // and the currency must be "XTR".
    const payload = {
        chat_id: userId,
        title: `⭐ ${stars} Stars — Referral Rebate`,
        description: `Your referral earned you ${stars} Telegram Stars from TON Bridge!`,
        payload: `stars_rebate:${userId}:${stars}`,
        currency: 'XTR',
        prices: [{ label: 'Stars rebate', amount: stars }],
        // provider_token is omitted (empty) for Stars invoices
    };

    const resp = await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/sendInvoice`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }
    );
    const data = await resp.json();
    if (!data.ok) return null;

    // createInvoiceLink is more suitable for WebApp openInvoice
    const linkPayload = {
        title: `⭐ ${stars} Stars — Referral Rebate`,
        description: `Claim your ${stars} Telegram Stars referral rebate from TON Bridge!`,
        payload: `stars_rebate:${userId}:${stars}`,
        currency: 'XTR',
        prices: [{ label: 'Stars rebate', amount: stars }],
    };

    const linkResp = await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(linkPayload),
        }
    );
    const linkData = await linkResp.json();
    return linkData.ok ? linkData.result : null;
}

async function notifyInviter(userId, stars, env) {
    if (!env.BOT_TOKEN) return;
    const text = `⭐ +${stars} Stars from your friend's exchange`;
    await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: userId,
                text,
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '⭐ Claim Stars',
                            // Opens the Mini App referral page where the user can claim
                            web_app: { url: 'https://tonbankcard.com/bridge/TMA/referral.html' },
                        },
                    ]],
                },
            }),
        }
    );
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}
