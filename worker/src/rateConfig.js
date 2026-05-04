/**
 * Rate-knob configuration loader and validator (issue #55 — Phase 6.12)
 *
 * Reads every economic knob from the worker environment, validates ranges and
 * internal consistency, then seeds the `program_config` table on first boot.
 *
 * Every `point_ledger` row is expected to carry a `config_id` FK pointing to
 * the row that was active when it was written, ensuring historical ledger rows
 * remain reproducible even after the env changes.
 *
 * @module rateConfig
 */

// ---------------------------------------------------------------------------
// Defaults (from IMPROVEMENTS.md §6.0)
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  SERVICE_BPS:            40,
  CASHBACK_BPS:           10,
  REFERRAL_BPS:           10,
  POINT_USD_VALUE:        0.00003,
  POINTS_PER_TBC:         10,
  MIN_REDEEM_POINTS:      100,
  DAILY_TURNOVER_CAP_USD: 50_000,
};

// ---------------------------------------------------------------------------
// Valid ranges
// ---------------------------------------------------------------------------

const RANGES = {
  SERVICE_BPS:            { min: 1,       max: 10_000 },
  CASHBACK_BPS:           { min: 0,       max: 10_000 },
  REFERRAL_BPS:           { min: 0,       max: 10_000 },
  POINT_USD_VALUE:        { min: 1e-10,   max: 1      },
  POINTS_PER_TBC:         { min: 1,       max: 1_000_000 },
  MIN_REDEEM_POINTS:      { min: 1,       max: 10_000_000 },
  DAILY_TURNOVER_CAP_USD: { min: 1,       max: 1_000_000_000 },
};

// ---------------------------------------------------------------------------
// parseRateConfig
// ---------------------------------------------------------------------------

/**
 * Parse and validate rate knobs from the Cloudflare Worker env object.
 *
 * Throws a descriptive Error if any knob is out of range or the constraint
 * `cashback_bps + referral_bps <= service_bps` is violated.
 *
 * @param {object} env - Worker environment (env.CASHBACK_BPS, etc.)
 * @returns {{
 *   serviceBps: number,
 *   cashbackBps: number,
 *   referralBps: number,
 *   pointUsdValue: number,
 *   pointsPerTbc: number,
 *   minRedeemPoints: number,
 *   dailyTurnoverCapUsd: number,
 * }}
 */
export function parseRateConfig(env) {
  const raw = {
    SERVICE_BPS:            env.SERVICE_BPS            ?? DEFAULTS.SERVICE_BPS,
    CASHBACK_BPS:           env.CASHBACK_BPS           ?? DEFAULTS.CASHBACK_BPS,
    REFERRAL_BPS:           env.REFERRAL_BPS           ?? DEFAULTS.REFERRAL_BPS,
    POINT_USD_VALUE:        env.POINT_USD_VALUE        ?? DEFAULTS.POINT_USD_VALUE,
    POINTS_PER_TBC:         env.POINTS_PER_TBC         ?? DEFAULTS.POINTS_PER_TBC,
    MIN_REDEEM_POINTS:      env.MIN_REDEEM_POINTS      ?? DEFAULTS.MIN_REDEEM_POINTS,
    DAILY_TURNOVER_CAP_USD: env.DAILY_TURNOVER_CAP_USD ?? DEFAULTS.DAILY_TURNOVER_CAP_USD,
  };

  const parsed = {
    SERVICE_BPS:            Number(raw.SERVICE_BPS),
    CASHBACK_BPS:           Number(raw.CASHBACK_BPS),
    REFERRAL_BPS:           Number(raw.REFERRAL_BPS),
    POINT_USD_VALUE:        Number(raw.POINT_USD_VALUE),
    POINTS_PER_TBC:         Number(raw.POINTS_PER_TBC),
    MIN_REDEEM_POINTS:      Number(raw.MIN_REDEEM_POINTS),
    DAILY_TURNOVER_CAP_USD: Number(raw.DAILY_TURNOVER_CAP_USD),
  };

  // Range checks
  for (const [key, { min, max }] of Object.entries(RANGES)) {
    const v = parsed[key];
    if (!Number.isFinite(v)) {
      throw new Error(`rateConfig: ${key} is not a finite number (got ${raw[key]})`);
    }
    if (v < min || v > max) {
      throw new Error(`rateConfig: ${key}=${v} is out of range [${min}, ${max}]`);
    }
  }

  // Internal consistency: cashback + referral must not exceed service commission
  const totalRebate = parsed.CASHBACK_BPS + parsed.REFERRAL_BPS;
  if (totalRebate > parsed.SERVICE_BPS) {
    throw new Error(
      `rateConfig: cashback_bps (${parsed.CASHBACK_BPS}) + referral_bps (${parsed.REFERRAL_BPS})` +
      ` = ${totalRebate} exceeds service_bps (${parsed.SERVICE_BPS}) — house would run at a loss`,
    );
  }

  return {
    serviceBps:           parsed.SERVICE_BPS,
    cashbackBps:          parsed.CASHBACK_BPS,
    referralBps:          parsed.REFERRAL_BPS,
    pointUsdValue:        parsed.POINT_USD_VALUE,
    pointsPerTbc:         parsed.POINTS_PER_TBC,
    minRedeemPoints:      parsed.MIN_REDEEM_POINTS,
    dailyTurnoverCapUsd:  parsed.DAILY_TURNOVER_CAP_USD,
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Insert a program_config row and return its id.
 *
 * @param {object} db           - D1 database binding
 * @param {object} cfg          - parsed rate config (from parseRateConfig)
 * @param {string} proposedBy   - 'boot' | 'admin:<telegram_id>'
 * @param {number} effectiveAt  - unix seconds when the config takes effect
 * @returns {Promise<number>}   - inserted row id
 */
export async function insertProgramConfig(db, cfg, proposedBy, effectiveAt) {
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(`
    INSERT INTO program_config
      (service_bps, cashback_bps, referral_bps, point_usd_value,
       points_per_tbc, min_redeem_pts, daily_cap_usd,
       proposed_by, effective_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    cfg.serviceBps,
    cfg.cashbackBps,
    cfg.referralBps,
    cfg.pointUsdValue,
    cfg.pointsPerTbc,
    cfg.minRedeemPoints,
    cfg.dailyTurnoverCapUsd,
    proposedBy,
    effectiveAt,
    now,
  ).run();

  return result.meta?.last_row_id ?? result.lastRowId;
}

/**
 * Return the active program_config row (latest effective_at <= now).
 *
 * @param {object} db - D1 database binding
 * @returns {Promise<object|null>}
 */
export async function getActiveConfig(db) {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT * FROM program_config
    WHERE effective_at <= ?
    ORDER BY effective_at DESC
    LIMIT 1
  `).bind(now).first();
}

/**
 * Ensure that a program_config row exists in the database.
 *
 * Called on every worker boot. If no row exists, inserts the env-derived
 * config with effective_at = now (immediately active). If a row already
 * exists, this is a no-op so the persisted history is never overwritten.
 *
 * @param {object} db   - D1 database binding
 * @param {object} cfg  - parsed rate config (from parseRateConfig)
 * @returns {Promise<void>}
 */
export async function seedConfigOnBoot(db, cfg) {
  const existing = await db.prepare('SELECT id FROM program_config LIMIT 1').first();
  if (existing) return;

  const now = Math.floor(Date.now() / 1000);
  await insertProgramConfig(db, cfg, 'boot', now);
}
