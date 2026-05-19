/**
 * Admin panel authenticated endpoints (issue #121).
 *
 * Replaces the inline demo data previously rendered by
 * `assets/js/admin.js` with authenticated server-side data drawn from D1.
 *
 * Authentication
 *   Each handler reads the Telegram WebApp initData from one of:
 *     1. `Authorization: tma <initData>` header (preferred)
 *     2. Query parameter `?initData=...` (GET requests)
 *     3. JSON body `{ "initData": "..." }` (POST requests)
 *   The initData is validated against env.BOT_TOKEN via HMAC-SHA-256.
 *
 * Authorisation
 *   After authentication, the parsed `user.id` must appear in the
 *   `env.ADMIN_TELEGRAM_IDS` comma-separated allow-list. The same env var
 *   is consumed by the static `<meta name="admin-ids">` tag for the
 *   client-side fast-path, but the worker is the source of truth.
 *
 * Routes
 *   GET  /admin/api/stats              — turnover / points / TBC payouts
 *   GET  /admin/api/fraud-flags        — paginated fraud flags
 *   POST /admin/api/fraud-flags/resolve — resolve a flag, writes audit row
 *   GET  /admin/api/top-users          — top 20 users by lifetime turnover
 *   GET  /admin/api/audit-log          — recent audit-log entries
 *
 * @module adminPanel
 */

import { validateInitData } from './validateInitData.js';

const SECONDS_PER_DAY = 24 * 60 * 60;
const FRAUD_PAGE_SIZE = 5;
const FRAUD_MAX_PAGE_SIZE = 50;
const TOP_USERS_LIMIT = 20;
const AUDIT_LOG_LIMIT = 50;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Parse the comma-separated allow-list from env.ADMIN_TELEGRAM_IDS.
 * Empty / missing → empty Set (locks everyone out).
 *
 * @param {string|undefined} raw
 * @returns {Set<number>}
 */
export function parseAdminIds(raw) {
  if (!raw || typeof raw !== 'string') return new Set();
  const ids = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => Number(s))
    .filter(n => Number.isInteger(n) && n > 0);
  return new Set(ids);
}

/**
 * Extract initData from a request.
 * Looks at Authorization: tma <initData> first, then query, then JSON body.
 *
 * Returns the raw initData string or null when not present.
 *
 * @param {Request} request
 * @param {URL} url
 * @param {object|null} body  — pre-parsed JSON body (POSTs only)
 */
function extractInitData(request, url, body) {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('tma ')) return authHeader.slice(4).trim();
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();

  const qp = url.searchParams.get('initData');
  if (qp) return qp;

  if (body && typeof body.initData === 'string') return body.initData;

  return null;
}

/**
 * Authenticate (Telegram initData) + authorise (allow-list) a request.
 *
 * @returns {Promise<{ok:true, userId:number} | {ok:false, status:number, error:string}>}
 */
async function requireAdmin(request, url, env, body = null) {
  const initData = extractInitData(request, url, body);
  if (!initData) return { ok: false, status: 401, error: 'missing_init_data' };

  let user;
  try {
    user = await validateInitData(initData, env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || '');
  } catch (err) {
    // In dev/test mode without a real bot token, fall back to parsing the
    // user field directly so worker tests can run without HMAC.
    if (env.DEV_MODE === 'true') {
      try {
        const params = new URLSearchParams(initData);
        user = JSON.parse(params.get('user') || '{}');
      } catch {
        return { ok: false, status: 401, error: 'unauthorized' };
      }
    } else {
      return { ok: false, status: 401, error: 'unauthorized' };
    }
  }

  const userId = user && Number(user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  const allowed = parseAdminIds(env.ADMIN_TELEGRAM_IDS);
  if (allowed.size === 0 || !allowed.has(userId)) {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function jsonError(error, status, extraHeaders = {}) {
  return jsonResponse({ ok: false, error }, status, extraHeaders);
}

// ---------------------------------------------------------------------------
// GET /admin/api/stats
// ---------------------------------------------------------------------------

/**
 * Aggregate turnover / points / TBC payout statistics.
 *
 * Numbers are pulled from the existing `swaps`, `point_ledger`, and
 * `redemptions` tables — no schema changes required.
 *
 * @param {object} db   — D1 binding (or compatible mock)
 * @param {number} nowS — current unix timestamp
 */
export async function computeAdminStats(db, nowS) {
  const d1Start  = nowS - 1 * SECONDS_PER_DAY;
  const d7Start  = nowS - 7 * SECONDS_PER_DAY;
  const d30Start = nowS - 30 * SECONDS_PER_DAY;

  const turnover24 = await db.prepare(
    "SELECT COALESCE(SUM(turnover_usd), 0) AS v FROM swaps WHERE status='finished' AND finished_at >= ?"
  ).bind(d1Start).first();

  const turnover7 = await db.prepare(
    "SELECT COALESCE(SUM(turnover_usd), 0) AS v FROM swaps WHERE status='finished' AND finished_at >= ?"
  ).bind(d7Start).first();

  const turnover30 = await db.prepare(
    "SELECT COALESCE(SUM(turnover_usd), 0) AS v FROM swaps WHERE status='finished' AND finished_at >= ?"
  ).bind(d30Start).first();

  // Outstanding = net positive (credits + redemptions); redeemed = absolute value
  // of negative `redemption`-role rows.
  const outstanding = await db.prepare(
    "SELECT COALESCE(SUM(delta_points), 0) AS v FROM point_ledger"
  ).first();

  const redeemed = await db.prepare(
    "SELECT COALESCE(-SUM(delta_points), 0) AS v FROM point_ledger WHERE role='redemption' AND delta_points < 0"
  ).first();

  const tbcPaid = await db.prepare(
    "SELECT COUNT(*) AS c, COALESCE(SUM(tbc_amount), 0) AS total FROM redemptions WHERE status='paid'"
  ).first();

  // The USD equivalent of paid-out TBC. We treat 1 TBC ≈ POINTS_PER_TBC * POINT_USD_VALUE
  // as a server-side computed estimate so the UI doesn't have to know rate knobs.
  // Both values are present in env (see wrangler.toml [vars]).
  return {
    turnover: {
      h24: Number(turnover24?.v ?? 0),
      d7:  Number(turnover7?.v ?? 0),
      d30: Number(turnover30?.v ?? 0),
    },
    points_outstanding: Number(outstanding?.v ?? 0),
    points_redeemed:    Number(redeemed?.v ?? 0),
    tbc_paid: {
      count:      Number(tbcPaid?.c ?? 0),
      tbc_total:  Number(tbcPaid?.total ?? 0),
    },
  };
}

async function handleStats(request, url, env) {
  const auth = await requireAdmin(request, url, env);
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const nowS = Math.floor(Date.now() / 1000);
  const stats = await computeAdminStats(env.DB, nowS);

  // Compute USD equivalent here so the UI is purely a presenter.
  const pointsPerTbc = Number(env.POINTS_PER_TBC ?? 10);
  const pointUsd     = Number(env.POINT_USD_VALUE ?? 0);
  stats.tbc_paid.usd_equiv = Number(
    (stats.tbc_paid.tbc_total * pointsPerTbc * pointUsd).toFixed(2),
  );

  return jsonResponse({ ok: true, stats });
}

// ---------------------------------------------------------------------------
// GET /admin/api/fraud-flags
// ---------------------------------------------------------------------------

async function handleFraudFlags(request, url, env) {
  const auth = await requireAdmin(request, url, env);
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const pageParam = Number(url.searchParams.get('page') ?? '0');
  const page = Number.isFinite(pageParam) && pageParam >= 0 ? Math.floor(pageParam) : 0;
  const sizeParam = Number(url.searchParams.get('size') ?? FRAUD_PAGE_SIZE);
  const size = Math.min(
    Math.max(1, Number.isFinite(sizeParam) ? Math.floor(sizeParam) : FRAUD_PAGE_SIZE),
    FRAUD_MAX_PAGE_SIZE,
  );

  const totalRow = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM fraud_flags'
  ).first();
  const total = Number(totalRow?.c ?? 0);

  const offset = page * size;
  const rows = await env.DB.prepare(`
    SELECT id, user_id, reason, amount_points, created_at, resolved
    FROM fraud_flags
    ORDER BY resolved ASC, created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).bind(size, offset).all();

  return jsonResponse({
    ok: true,
    page,
    size,
    total,
    items: (rows.results || []).map(r => ({
      id:            Number(r.id),
      user_id:       Number(r.user_id),
      reason:        String(r.reason),
      amount_points: Number(r.amount_points),
      created_at:    Number(r.created_at),
      resolved:      Number(r.resolved) === 1,
    })),
  });
}

// ---------------------------------------------------------------------------
// POST /admin/api/fraud-flags/resolve
// ---------------------------------------------------------------------------

async function handleResolveFraudFlag(request, url, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('bad_request', 400);
  }

  const auth = await requireAdmin(request, url, env, body);
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const id = Number(body && body.id);
  if (!Number.isInteger(id) || id <= 0) return jsonError('bad_request', 400);

  const current = await env.DB.prepare(
    'SELECT id, resolved FROM fraud_flags WHERE id = ?'
  ).bind(id).first();
  if (!current) return jsonError('not_found', 404);
  if (Number(current.resolved) === 1) return jsonError('already_resolved', 409);

  const nowS = Math.floor(Date.now() / 1000);
  const before = JSON.stringify({ resolved: false });
  const after  = JSON.stringify({ resolved: true });

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE fraud_flags SET resolved = 1, resolved_at = ?, resolved_by = ? WHERE id = ?'
    ).bind(nowS, auth.userId, id),
    env.DB.prepare(
      `INSERT INTO audit_log (actor_id, action, target, before_json, after_json, created_at)
       VALUES (?, 'resolve_fraud_flag', ?, ?, ?, ?)`
    ).bind(auth.userId, `fraud_flag:${id}`, before, after, nowS),
  ]);

  return jsonResponse({ ok: true, id, resolved_at: nowS });
}

// ---------------------------------------------------------------------------
// GET /admin/api/top-users
// ---------------------------------------------------------------------------

async function handleTopUsers(request, url, env) {
  const auth = await requireAdmin(request, url, env);
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const rows = await env.DB.prepare(`
    SELECT user_id, SUM(turnover_usd) AS lifetime_usd
    FROM swaps
    WHERE status = 'finished'
    GROUP BY user_id
    ORDER BY lifetime_usd DESC
    LIMIT ?
  `).bind(TOP_USERS_LIMIT).all();

  const items = (rows.results || []).map((r, i) => ({
    rank:         i + 1,
    user_id:      Number(r.user_id),
    lifetime_usd: Number(r.lifetime_usd ?? 0),
  }));

  return jsonResponse({ ok: true, items });
}

// ---------------------------------------------------------------------------
// GET /admin/api/audit-log
// ---------------------------------------------------------------------------

async function handleAuditLog(request, url, env) {
  const auth = await requireAdmin(request, url, env);
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const limitParam = Number(url.searchParams.get('limit') ?? AUDIT_LOG_LIMIT);
  const limit = Math.min(
    Math.max(1, Number.isFinite(limitParam) ? Math.floor(limitParam) : AUDIT_LOG_LIMIT),
    AUDIT_LOG_LIMIT,
  );

  const rows = await env.DB.prepare(`
    SELECT id, actor_id, action, target, before_json, after_json, created_at
    FROM audit_log
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(limit).all();

  const items = (rows.results || []).map(r => ({
    id:         Number(r.id),
    actor_id:   Number(r.actor_id),
    action:     String(r.action),
    target:     r.target ? String(r.target) : null,
    before:     r.before_json ? safeParseJSON(r.before_json) : null,
    after:      r.after_json  ? safeParseJSON(r.after_json)  : null,
    created_at: Number(r.created_at),
  }));

  return jsonResponse({ ok: true, items });
}

function safeParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Router entry point
// ---------------------------------------------------------------------------

/**
 * Returns a Response if the request matches an admin panel route,
 * or null when the caller should fall through to other routes.
 *
 * @param {Request} request
 * @param {URL} url
 * @param {object} env
 * @returns {Promise<Response|null>}
 */
export async function handleAdminPanelRequest(request, url, env) {
  const path = url.pathname;
  const method = request.method;

  if (method === 'GET' && path === '/admin/api/stats') {
    return handleStats(request, url, env);
  }
  if (method === 'GET' && path === '/admin/api/fraud-flags') {
    return handleFraudFlags(request, url, env);
  }
  if (method === 'POST' && path === '/admin/api/fraud-flags/resolve') {
    return handleResolveFraudFlag(request, url, env);
  }
  if (method === 'GET' && path === '/admin/api/top-users') {
    return handleTopUsers(request, url, env);
  }
  if (method === 'GET' && path === '/admin/api/audit-log') {
    return handleAuditLog(request, url, env);
  }
  return null;
}

// Exported for tests
export const _internals = {
  requireAdmin,
  extractInitData,
  parseAdminIds,
};
