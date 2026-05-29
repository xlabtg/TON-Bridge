/**
 * Point accrual job (issue #48 — Phase 6.5)
 *
 * Polls the ChangeNOW partner API for finished swaps attributed to our
 * link_id, resolves USD turnover (#6.4), and writes atomic ledger entries
 * for the trader (cashback) and referrer (if any).
 *
 * Designed to run as a Cloudflare Worker scheduled handler (cron: every 60 s)
 * and also as an on-demand admin replay (POST /admin/replay?from=<unix>).
 *
 * Idempotency is enforced at the DB layer by the UNIQUE INDEX
 * `uq_ledger_swap_role` on (swap_id, role) — concurrent runs cannot
 * double-credit.
 *
 * @module accrualJob
 */

import { calcPoints } from './pointFormula.js';
import { getActiveConfigId } from './rateConfig.js';

// ---------------------------------------------------------------------------
// ChangeNOW API
// ---------------------------------------------------------------------------

/**
 * Fetch finished swaps from the ChangeNOW partner endpoint.
 *
 * Docs: GET /v2/exchange/by-partner?status=finished&from=<unix>
 * Returns an array of swap objects.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {number} opts.fromUnix  - cursor: fetch swaps finished after this timestamp
 * @param {Function} [opts.fetch] - injectable for tests
 * @returns {Promise<Array>}
 */
export async function fetchFinishedSwaps({ apiKey, fromUnix, fetch: _fetch = globalThis.fetch }) {
  const url = new URL('https://api.changenow.io/v2/exchange/by-partner');
  url.searchParams.set('status', 'finished');
  url.searchParams.set('from', String(fromUnix));

  const res = await _fetch(url.toString(), {
    headers: { 'x-changenow-api-key': apiKey },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ChangeNOW API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  // API may return an array directly or wrapped in { items: [...] }
  return Array.isArray(data) ? data : (data.items ?? []);
}

// ---------------------------------------------------------------------------
// USD oracle (thin wrapper — real logic lives in src/usdOracle.js, #6.4)
// ---------------------------------------------------------------------------

/**
 * Resolve the USD turnover for a swap.
 *
 * If the swap already carries amountInUsd / fromAmountInUsd from ChangeNOW
 * we use that directly (no extra API call).  Otherwise we delegate to the
 * injected oracle (src/usdOracle.js).
 *
 * @param {object} swap       - raw ChangeNOW swap object
 * @param {Function} oracle   - async (symbol, amount, atUnixSec, partnerId) => number|null
 * @returns {Promise<{usd: number, source: string}|null>}
 */
export async function resolveUsd(swap, oracle) {
  const direct = Number(swap.amountInUsd ?? swap.toAmountInUsd ?? swap.fromAmountInUsd ?? NaN);
  if (Number.isFinite(direct) && direct > 0) {
    return { usd: direct, source: 'changenow' };
  }

  const result = await oracle(
    swap.fromCurrency ?? swap.from,
    Number(swap.fromAmount ?? swap.amount ?? 0),
    swap.finishedAt ?? swap.finished_at ?? Math.floor(Date.now() / 1000),
    swap.id,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Core accrual logic
// ---------------------------------------------------------------------------

const NOW_API_KEY_DEFAULT = '';
const CASHBACK_BPS_DEFAULT = 10;
const REFERRAL_BPS_DEFAULT = 10;

/**
 * Process a single ChangeNOW swap and write ledger entries.
 *
 * Uses D1's `batch()` so the swaps row insert and every ledger row insert
 * are committed atomically.  The UNIQUE INDEX means a second invocation for
 * the same (swap_id, role) pair silently fails with SQLITE_CONSTRAINT —
 * we catch that and treat it as "already accrued" (idempotent).
 *
 * @param {object} swap           - raw swap object from ChangeNOW API
 * @param {object} opts
 * @param {object} opts.db        - D1 Database binding (or compatible mock)
 * @param {Function} opts.oracle  - USD oracle function
 * @param {number}  opts.cashbackBps
 * @param {number}  opts.referralBps
 * @param {number|null} [opts.configId] - active program_config id stamped on ledger rows (#184)
 * @param {object}  [opts.log]    - logger object with .info() and .warn()
 * @returns {Promise<'accrued'|'skipped'|'no_user'|'no_usd'>}
 */
export async function processSwap(swap, { db, oracle, cashbackBps, referralBps, configId = null, log = console }) {
  const partnerTxnId = swap.id ?? swap.partner_txn_id;
  const partnerUserId = swap.userId ?? swap.partner_user_id ?? swap.externalId ?? swap.external_id;

  if (!partnerTxnId) {
    log.warn({ swap }, 'accrual: swap missing id — skipping');
    return 'skipped';
  }

  // Resolve the user via partner_user_id we attached on iframe init (#1.7)
  const userRow = partnerUserId
    ? await db.prepare('SELECT telegram_id, referred_by FROM users WHERE telegram_id = ?')
        .bind(Number(partnerUserId))
        .first()
    : null;

  if (!userRow) {
    log.warn({ partnerTxnId, partnerUserId }, 'accrual: user not found — leaving unattributed');
    return 'no_user';
  }

  const finishedAt = swap.finishedAt ?? swap.finished_at ?? Math.floor(Date.now() / 1000);

  // Resolve USD turnover
  const usdResult = await resolveUsd(swap, oracle);
  if (!usdResult) {
    log.warn({ partnerTxnId }, 'accrual: USD oracle returned null — will retry next run');
    return 'no_usd';
  }

  const { usd: turnoverUsd, source: usdRateSource } = usdResult;

  const traderPoints  = calcPoints(turnoverUsd, cashbackBps);
  const now           = Math.floor(Date.now() / 1000);
  const fromCurrency  = swap.fromCurrency ?? swap.from ?? '';
  const toCurrency    = swap.toCurrency   ?? swap.to   ?? '';
  const fromAmount    = Number(swap.fromAmount ?? swap.amount ?? 0);
  const toAmount      = Number(swap.toAmount   ?? 0);

  log.info({
    partnerTxnId,
    userId: userRow.telegram_id,
    turnoverUsd,
    usdRateSource,
    traderPoints,
    referrer: userRow.referred_by ?? null,
  }, 'accrual: processing swap');

  // Build batch statements
  const stmts = [];

  // 1. Upsert swaps row (INSERT OR IGNORE to handle retries gracefully)
  stmts.push(
    db.prepare(`
      INSERT OR IGNORE INTO swaps
        (id, user_id, from_currency, to_currency, from_amount, to_amount,
         turnover_usd, usd_rate_source, status, created_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'finished', ?, ?)
    `).bind(
      partnerTxnId,
      userRow.telegram_id,
      fromCurrency,
      toCurrency,
      fromAmount,
      toAmount,
      turnoverUsd,
      usdRateSource,
      now,
      finishedAt,
    ),
  );

  // 2. Trader cashback ledger row (INSERT OR IGNORE for idempotency)
  stmts.push(
    db.prepare(`
      INSERT OR IGNORE INTO point_ledger
        (user_id, swap_id, role, delta_points, rate_bps, created_at, config_id)
      VALUES (?, ?, 'trader', ?, ?, ?, ?)
    `).bind(userRow.telegram_id, partnerTxnId, traderPoints, cashbackBps, now, configId),
  );

  // 3. Referrer ledger row (only if referred_by is set)
  if (userRow.referred_by != null) {
    const referrerPoints = calcPoints(turnoverUsd, referralBps);
    log.info({
      partnerTxnId,
      referrerId: userRow.referred_by,
      referrerPoints,
    }, 'accrual: writing referrer row');

    stmts.push(
      db.prepare(`
        INSERT OR IGNORE INTO point_ledger
          (user_id, swap_id, role, delta_points, rate_bps, created_at, config_id)
        VALUES (?, ?, 'referrer', ?, ?, ?, ?)
      `).bind(userRow.referred_by, partnerTxnId, referrerPoints, referralBps, now, configId),
    );
  }

  try {
    await db.batch(stmts);
  } catch (err) {
    // UNIQUE constraint on (swap_id, role) means already accrued — safe to ignore
    if (String(err).includes('UNIQUE constraint') || String(err).includes('SQLITE_CONSTRAINT')) {
      log.info({ partnerTxnId }, 'accrual: already accrued — skipping');
      return 'skipped';
    }
    throw err;
  }

  return 'accrued';
}

// ---------------------------------------------------------------------------
// Main accrual runner
// ---------------------------------------------------------------------------

/**
 * Run a full accrual pass for all swaps finished after `fromUnix`.
 *
 * Updates the KV cursor when called from the cron handler so the next run
 * only fetches new swaps.
 *
 * @param {object} opts
 * @param {object}   opts.db
 * @param {object}   [opts.kv]          - KV namespace (optional; skipped in replay mode)
 * @param {Function} opts.oracle
 * @param {string}   opts.apiKey
 * @param {number}   opts.fromUnix
 * @param {number}   opts.cashbackBps
 * @param {number}   opts.referralBps
 * @param {boolean}  [opts.updateCursor] - set false in replay mode
 * @param {Function} [opts.fetch]
 * @param {object}   [opts.log]
 * @returns {Promise<{accrued:number, skipped:number, no_user:number, no_usd:number, errors:number}>}
 */
export async function runAccrual({
  db,
  kv,
  oracle,
  apiKey,
  fromUnix,
  cashbackBps = CASHBACK_BPS_DEFAULT,
  referralBps = REFERRAL_BPS_DEFAULT,
  updateCursor = true,
  fetch: _fetch = globalThis.fetch,
  log = console,
}) {
  const stats = { accrued: 0, skipped: 0, no_user: 0, no_usd: 0, errors: 0 };

  let swaps;
  try {
    swaps = await fetchFinishedSwaps({ apiKey, fromUnix, fetch: _fetch });
  } catch (err) {
    log.warn({ err: String(err) }, 'accrual: failed to fetch swaps from ChangeNOW');
    return stats;
  }

  log.info({ count: swaps.length, fromUnix }, 'accrual: fetched swaps');

  // Stamp every ledger row written this run with the rate config in effect (#184).
  const configId = await getActiveConfigId(db);

  let latestFinishedAt = fromUnix;

  for (const swap of swaps) {
    const swapFinishedAt = swap.finishedAt ?? swap.finished_at ?? 0;
    if (swapFinishedAt > latestFinishedAt) latestFinishedAt = swapFinishedAt;

    try {
      const outcome = await processSwap(swap, { db, oracle, cashbackBps, referralBps, configId, log });
      stats[outcome] = (stats[outcome] ?? 0) + 1;
    } catch (err) {
      log.warn({ err: String(err), swapId: swap.id }, 'accrual: unhandled error for swap');
      stats.errors++;
    }
  }

  // Advance the KV cursor so the next cron run only fetches new swaps
  if (updateCursor && kv && latestFinishedAt > fromUnix) {
    await kv.put('accrual:cursor', String(latestFinishedAt));
    log.info({ cursor: latestFinishedAt }, 'accrual: cursor advanced');
  }

  log.info(stats, 'accrual: run complete');
  return stats;
}

// ---------------------------------------------------------------------------
// Cloudflare Worker entry point
// ---------------------------------------------------------------------------

/**
 * Build the oracle function from env (delegates to usdOracle.js at runtime).
 * Separated so the cron handler stays thin and testable.
 *
 * @param {object} env
 * @param {Function} [_fetch]
 */
function buildOracle(env, _fetch) {
  // Import at call time so Node.js tests can stub this module
  return async (symbol, amount, atUnixSec, partnerId) => {
    const { usdValue } = await import('../../src/usdOracle.js');
    return usdValue(
      { symbol, amount, atUnixSec, partnerId },
      _fetch ? { fetch: _fetch } : {},
    );
  };
}

/**
 * Cloudflare Worker default export.
 *
 * Bindings expected in wrangler.toml:
 *   - DB  (D1 database)
 *   - KV  (KV namespace: ton-bridge-accrual)
 *
 * Environment variables:
 *   - CHANGENOW_API_KEY
 *   - CASHBACK_BPS  (default 10)
 *   - REFERRAL_BPS  (default 10)
 *   - ADMIN_SECRET  (for /admin/replay)
 */
export default {
  // Cron trigger: runs every 60 s (configured in wrangler.toml)
  async scheduled(_event, env, _ctx) {
    await runScheduledAccrual(env);
  },

  // HTTP handler: only exposes the admin replay endpoint
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/admin/replay') {
      return handleAdminReplay(request, url, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

export async function runScheduledAccrual(env) {
  const kv = env.ACCRUAL_KV ?? env.KV;
  const fromUnix = Number(await kv?.get('accrual:cursor') ?? '0') || 0;
  const oracle = buildOracle(env);

  return runAccrual({
    db: env.DB,
    kv,
    oracle,
    apiKey: env.CHANGENOW_API_KEY ?? NOW_API_KEY_DEFAULT,
    fromUnix,
    cashbackBps: Number(env.CASHBACK_BPS ?? CASHBACK_BPS_DEFAULT),
    referralBps: Number(env.REFERRAL_BPS ?? REFERRAL_BPS_DEFAULT),
    updateCursor: true,
  });
}

// ---------------------------------------------------------------------------
// Admin replay handler (extracted for testability)
// ---------------------------------------------------------------------------

/**
 * POST /admin/replay?from=<unix>
 *
 * Re-runs accrual from the given timestamp without updating the cursor.
 * The UNIQUE INDEX on (swap_id, role) prevents double-crediting.
 * Requires Bearer token matching env.ADMIN_SECRET.
 *
 * @param {Request} request
 * @param {URL}     url
 * @param {object}  env
 * @returns {Promise<Response>}
 */
export async function handleAdminReplay(request, url, env) {
  // Auth
  const auth = request.headers.get('Authorization') ?? '';
  if (!env.ADMIN_SECRET || auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const fromParam = url.searchParams.get('from');
  const fromUnix  = fromParam ? Number(fromParam) : 0;
  if (!Number.isFinite(fromUnix) || fromUnix < 0) {
    return new Response('Bad request: from must be a non-negative Unix timestamp', { status: 400 });
  }

  const oracle = buildOracle(env);

  const stats = await runAccrual({
    db:           env.DB,
    oracle,
    apiKey:       env.CHANGENOW_API_KEY ?? NOW_API_KEY_DEFAULT,
    fromUnix,
    cashbackBps:  Number(env.CASHBACK_BPS  ?? CASHBACK_BPS_DEFAULT),
    referralBps:  Number(env.REFERRAL_BPS  ?? REFERRAL_BPS_DEFAULT),
    updateCursor: false, // never advance cursor during replay
  });

  return new Response(JSON.stringify(stats), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
