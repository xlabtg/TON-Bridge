/**
 * POST /admin/config — propose a new rate-knob configuration (issue #55 — Phase 6.12)
 *
 * Accepts a JSON body with any subset of the rate knobs, validates the full
 * resulting config (merging with the current active config), persists an audit
 * row in `program_config`, and schedules it to become effective at the next
 * minute boundary.
 *
 * Authentication: Bearer token matching env.ADMIN_SECRET.
 *
 * @module adminConfig
 */

import { parseRateConfig, insertProgramConfig, getActiveConfig } from './rateConfig.js';

/**
 * Handle POST /admin/config.
 *
 * @param {Request} request
 * @param {object}  env     - Worker environment
 * @returns {Promise<Response>}
 */
export async function handleAdminConfig(request, env) {
  // --- Auth ---
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== (env.ADMIN_SECRET ?? '')) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // --- Parse body ---
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad_request', detail: 'invalid JSON' }, 400);
  }

  const db = env.DB;

  // --- Resolve base: current active config or env defaults ---
  const activeRow = await getActiveConfig(db);
  const baseEnv = activeRow
    ? rowToEnvShape(activeRow)
    : env;

  // Merge proposed overrides on top of the base
  const mergedEnv = { ...baseEnv, ...flattenProposal(body) };

  // --- Validate the merged config ---
  let cfg;
  try {
    cfg = parseRateConfig(mergedEnv);
  } catch (err) {
    return jsonResponse({ error: 'validation_failed', detail: err.message }, 422);
  }

  // --- Schedule: next minute boundary ---
  const now = Math.floor(Date.now() / 1000);
  const effectiveAt = nextMinuteBoundary(now);

  // --- Persist audit row ---
  const proposedBy = `admin:${body.proposed_by ?? 'unknown'}`;
  const id = await insertProgramConfig(db, cfg, proposedBy, effectiveAt);

  return jsonResponse({
    ok: true,
    config_id: id,
    effective_at: effectiveAt,
    effective_at_iso: new Date(effectiveAt * 1000).toISOString(),
    config: cfg,
  }, 201);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a program_config DB row back to env-variable shape for merging.
 */
function rowToEnvShape(row) {
  return {
    SERVICE_BPS:            row.service_bps,
    CASHBACK_BPS:           row.cashback_bps,
    REFERRAL_BPS:           row.referral_bps,
    POINT_USD_VALUE:        row.point_usd_value,
    POINTS_PER_TBC:         row.points_per_tbc,
    MIN_REDEEM_POINTS:      row.min_redeem_pts,
    DAILY_TURNOVER_CAP_USD: row.daily_cap_usd,
  };
}

/**
 * Map camelCase / snake_case proposal keys to the env-variable names.
 * Accepts either naming convention so callers are not forced to use uppercase.
 */
function flattenProposal(body) {
  const map = {
    service_bps:              'SERVICE_BPS',
    SERVICE_BPS:              'SERVICE_BPS',
    serviceBps:               'SERVICE_BPS',
    cashback_bps:             'CASHBACK_BPS',
    CASHBACK_BPS:             'CASHBACK_BPS',
    cashbackBps:              'CASHBACK_BPS',
    referral_bps:             'REFERRAL_BPS',
    REFERRAL_BPS:             'REFERRAL_BPS',
    referralBps:              'REFERRAL_BPS',
    point_usd_value:          'POINT_USD_VALUE',
    POINT_USD_VALUE:          'POINT_USD_VALUE',
    pointUsdValue:            'POINT_USD_VALUE',
    points_per_tbc:           'POINTS_PER_TBC',
    POINTS_PER_TBC:           'POINTS_PER_TBC',
    pointsPerTbc:             'POINTS_PER_TBC',
    min_redeem_points:        'MIN_REDEEM_POINTS',
    MIN_REDEEM_POINTS:        'MIN_REDEEM_POINTS',
    minRedeemPoints:          'MIN_REDEEM_POINTS',
    daily_turnover_cap_usd:   'DAILY_TURNOVER_CAP_USD',
    DAILY_TURNOVER_CAP_USD:   'DAILY_TURNOVER_CAP_USD',
    dailyTurnoverCapUsd:      'DAILY_TURNOVER_CAP_USD',
  };

  const out = {};
  for (const [key, value] of Object.entries(body)) {
    const envKey = map[key];
    if (envKey) out[envKey] = value;
  }
  return out;
}

/**
 * Return the unix timestamp of the next full-minute boundary after `now`.
 * e.g. if now = 12:34:47 → returns 12:35:00
 *
 * @param {number} nowSec - current unix timestamp in seconds
 * @returns {number}
 */
export function nextMinuteBoundary(nowSec) {
  return (Math.floor(nowSec / 60) + 1) * 60;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
