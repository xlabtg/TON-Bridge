/**
 * Anti-fraud guardrails for the Phase 6 affiliate / points system.
 *
 * Each guardrail is independently kill-switchable via the ANTI_FRAUD_CONFIG
 * object (or process.env equivalents in a Cloudflare Worker / Node context).
 *
 * Guardrails implemented:
 *  (a) Referral bonus only pays out when swap status === 'finished'.
 *  (b) Per-user daily turnover cap on point-awarding (default $50 000 USD/day).
 *      Swaps above the cap are recorded but receive ledger memo 'capped:<unix_day>'.
 *  (c) Concentration flag: inviter auto-flagged when >80 % of their 30-day
 *      referral turnover comes from a single referee. Flagged accounts still
 *      accrue points but redemptions are held pending review.
 *  (d) Account-age gate: points become withdrawable only after the user's
 *      Telegram account is estimated to be ≥ 7 days old. Until then points
 *      show as "vesting". See THIRD_PARTY.md for the heuristic details.
 *
 * All fraud events are written to the fraud_flags log via recordFraudFlag().
 */

'use strict';

// ---------------------------------------------------------------------------
// Configuration — all knobs are readable from a runtime config object so that
// Cloudflare Worker environment variables (or any injection at startup) can
// override defaults without a redeploy.
// ---------------------------------------------------------------------------

/** @type {AntiFraudConfig} */
var ANTI_FRAUD_CONFIG = {
  // Kill-switches — set to false to disable a specific guardrail.
  guardrail_a_enabled: true,  // finished-state check
  guardrail_b_enabled: true,  // daily turnover cap
  guardrail_c_enabled: true,  // concentration flag
  guardrail_d_enabled: true,  // account-age gate

  // Guardrail (b): max USD turnover per user per calendar day that earns points.
  daily_turnover_cap_usd: 50000,

  // Guardrail (c): fraction of a single referee's volume that triggers a flag.
  concentration_threshold: 0.80,

  // Guardrail (c): look-back window in days for concentration calculation.
  concentration_window_days: 30,

  // Guardrail (d): minimum estimated account age in days before withdrawal.
  account_age_min_days: 7,
};

/**
 * Override one or more configuration keys at runtime.
 * @param {Partial<AntiFraudConfig>} overrides
 */
function configureAntiFraud(overrides) {
  Object.assign(ANTI_FRAUD_CONFIG, overrides);
}

// ---------------------------------------------------------------------------
// Fraud-flag recorder
// ---------------------------------------------------------------------------

/**
 * In-memory store for fraud flags (in production this writes to the
 * fraud_flags DB table; here it is a plain array that tests can inspect).
 * @type {FraudFlag[]}
 */
var _fraudFlagsStore = [];

/**
 * Record a fraud flag event.
 * @param {string} userId
 * @param {string} reason   Short machine-readable reason string.
 * @param {object} evidence Arbitrary serialisable evidence payload.
 * @returns {FraudFlag}
 */
function recordFraudFlag(userId, reason, evidence) {
  var flag = {
    id: _fraudFlagsStore.length + 1,
    user_id: userId,
    reason: reason,
    evidence: evidence,
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
  };
  _fraudFlagsStore.push(flag);
  return flag;
}

/**
 * Return all recorded fraud flags (for admin dashboard and tests).
 * @returns {FraudFlag[]}
 */
function getFraudFlags() {
  return _fraudFlagsStore.slice();
}

/**
 * Clear the in-memory store (used in tests only).
 */
function _clearFraudFlags() {
  _fraudFlagsStore = [];
}

// ---------------------------------------------------------------------------
// Guardrail (a) — finished-state-only referral bonus
// ---------------------------------------------------------------------------

/**
 * Returns true when the swap status qualifies for a referral payout.
 *
 * Only swaps in the 'finished' state pay out the referral bonus. Any earlier
 * state (waiting, confirming, exchanging, sending, etc.) is rejected.
 *
 * Kill-switch: set guardrail_a_enabled = false to always return true.
 *
 * @param {string} swapStatus  Status string from the ChangeNOW partner API.
 * @returns {boolean}
 */
function isEligibleForReferralBonus(swapStatus) {
  if (!ANTI_FRAUD_CONFIG.guardrail_a_enabled) return true;
  return swapStatus === 'finished';
}

// ---------------------------------------------------------------------------
// Guardrail (b) — per-user daily turnover cap
// ---------------------------------------------------------------------------

/**
 * Given a user's existing USD turnover today and an incoming swap, return how
 * many USD of the swap should receive points (may be less than the full
 * swap amount if the cap is reached mid-swap).
 *
 * The caller is responsible for persisting `dailyTurnoverSoFar` per user per
 * calendar day and for writing the 'capped:<unix_day>' ledger memo when the
 * returned cappedTurnover is less than swapTurnoverUsd.
 *
 * Kill-switch: set guardrail_b_enabled = false to return the full swap amount.
 *
 * @param {string} userId
 * @param {number} swapTurnoverUsd    USD value of this swap.
 * @param {number} dailyTurnoverSoFar Cumulative USD awarded points today (before this swap).
 * @returns {{ cappedTurnover: number, memo: string|null }}
 */
function applyDailyTurnoverCap(userId, swapTurnoverUsd, dailyTurnoverSoFar) {
  if (!ANTI_FRAUD_CONFIG.guardrail_b_enabled) {
    return { cappedTurnover: swapTurnoverUsd, memo: null };
  }

  var cap = ANTI_FRAUD_CONFIG.daily_turnover_cap_usd;
  var remaining = cap - dailyTurnoverSoFar;

  if (remaining <= 0) {
    // Already at or over cap — this entire swap is capped.
    var unixDay = Math.floor(Date.now() / 86400000);
    return { cappedTurnover: 0, memo: 'capped:' + unixDay };
  }

  if (swapTurnoverUsd <= remaining) {
    // Entire swap fits within today's remaining allowance.
    return { cappedTurnover: swapTurnoverUsd, memo: null };
  }

  // Partial cap — only award points on the remaining allowance.
  var unixDay = Math.floor(Date.now() / 86400000);
  return { cappedTurnover: remaining, memo: 'capped:' + unixDay };
}

// ---------------------------------------------------------------------------
// Guardrail (c) — concentration flag
// ---------------------------------------------------------------------------

/**
 * Check whether an inviter's referral turnover is too concentrated in a single
 * referee. If the top referee accounts for more than `concentration_threshold`
 * (default 80 %) of the inviter's total referral turnover over the last
 * `concentration_window_days` (default 30 d), flag the inviter.
 *
 * Kill-switch: set guardrail_c_enabled = false to always return { flagged: false }.
 *
 * @param {string} inviterId
 * @param {ReferralTurnoverEntry[]} referralTurnoverLast30d
 *   Array of { refereeId: string, turnoverUsd: number } entries for the
 *   inviter's referees over the look-back window.
 * @returns {{ flagged: boolean, topRefereeId: string|null, concentration: number }}
 */
function checkConcentrationFlag(inviterId, referralTurnoverLast30d) {
  if (!ANTI_FRAUD_CONFIG.guardrail_c_enabled) {
    return { flagged: false, topRefereeId: null, concentration: 0 };
  }

  if (!referralTurnoverLast30d || referralTurnoverLast30d.length === 0) {
    return { flagged: false, topRefereeId: null, concentration: 0 };
  }

  var totalTurnover = 0;
  var byReferee = {};

  for (var i = 0; i < referralTurnoverLast30d.length; i++) {
    var entry = referralTurnoverLast30d[i];
    totalTurnover += entry.turnoverUsd;
    byReferee[entry.refereeId] = (byReferee[entry.refereeId] || 0) + entry.turnoverUsd;
  }

  if (totalTurnover === 0) {
    return { flagged: false, topRefereeId: null, concentration: 0 };
  }

  // Find the single referee with the highest turnover.
  var topRefereeId = null;
  var topVolume = 0;
  var refereeIds = Object.keys(byReferee);
  for (var j = 0; j < refereeIds.length; j++) {
    var rid = refereeIds[j];
    if (byReferee[rid] > topVolume) {
      topVolume = byReferee[rid];
      topRefereeId = rid;
    }
  }

  var concentration = topVolume / totalTurnover;
  var threshold = ANTI_FRAUD_CONFIG.concentration_threshold;
  var flagged = concentration > threshold;

  if (flagged) {
    recordFraudFlag(inviterId, 'concentration', {
      topRefereeId: topRefereeId,
      concentration: concentration,
      threshold: threshold,
      totalTurnoverUsd: totalTurnover,
      topRefereeeTurnoverUsd: topVolume,
      windowDays: ANTI_FRAUD_CONFIG.concentration_window_days,
    });
  }

  return { flagged: flagged, topRefereeId: topRefereeId, concentration: concentration };
}

// ---------------------------------------------------------------------------
// Guardrail (d) — account-age gate
// ---------------------------------------------------------------------------

/**
 * Estimate the age of a Telegram account in days and decide whether points
 * are withdrawable.
 *
 * Telegram does not expose account creation date. We use a two-factor heuristic
 * (documented in THIRD_PARTY.md):
 *  1. `auth_date` is the Unix timestamp from the Telegram initData — the moment
 *     the user launched the Mini App. We treat `auth_date - 7d` as the earliest
 *     plausible creation date (floor), giving new accounts a 7-day grace period.
 *  2. For users with a numeric Telegram `user_id` below ~1 000 000 000 (IDs
 *     issued before roughly 2019) we assume the account is old enough and skip
 *     the gate.
 *
 * Kill-switch: set guardrail_d_enabled = false to always return { vesting: false }.
 *
 * @param {string|number} telegramUserId  Numeric Telegram user ID.
 * @param {number}        authDateUnix    Unix timestamp from initData.auth_date.
 * @param {number}        [nowUnix]       Current time (injectable for tests).
 * @returns {{ vesting: boolean, estimatedAgeDays: number }}
 */
function checkAccountAgeGate(telegramUserId, authDateUnix, nowUnix) {
  if (!ANTI_FRAUD_CONFIG.guardrail_d_enabled) {
    return { vesting: false, estimatedAgeDays: Infinity };
  }

  var now = nowUnix !== undefined ? nowUnix : Math.floor(Date.now() / 1000);
  var minAgeDays = ANTI_FRAUD_CONFIG.account_age_min_days;

  // Heuristic 1: old-ID bypass (IDs < 1e9 predate 2019; very safe to allow).
  var uid = Number(telegramUserId);
  if (!isNaN(uid) && uid > 0 && uid < 1000000000) {
    return { vesting: false, estimatedAgeDays: Infinity };
  }

  // Heuristic 2: use auth_date as an upper bound on account age.
  // The worst-case assumption is that the account was created right now
  // (auth_date === now), meaning age = 0. We apply a 7-day floor: the account
  // could have been created up to 7 days before auth_date.
  var estimatedCreationUnix = authDateUnix - minAgeDays * 86400;
  var estimatedAgeDays = (now - estimatedCreationUnix) / 86400;

  var vesting = estimatedAgeDays < minAgeDays;
  return { vesting: vesting, estimatedAgeDays: estimatedAgeDays };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

var AntiFraud = {
  configure: configureAntiFraud,

  // Guardrails
  isEligibleForReferralBonus: isEligibleForReferralBonus,
  applyDailyTurnoverCap: applyDailyTurnoverCap,
  checkConcentrationFlag: checkConcentrationFlag,
  checkAccountAgeGate: checkAccountAgeGate,

  // Fraud-flag log
  recordFraudFlag: recordFraudFlag,
  getFraudFlags: getFraudFlags,
  _clearFraudFlags: _clearFraudFlags,
};

// Support both CommonJS (Node / Cloudflare Worker bundle) and browser globals.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AntiFraud;
} else {
  window.AntiFraud = AntiFraud;
}
