/**
 * auth-verify.js — /auth/verify endpoint logic (issue #1.7 + #6.3)
 *
 * Validates Telegram initData, upserts the user row, and optionally captures
 * referral attribution when a valid start_param is present.
 *
 * Referral rules (all must pass; any failure is logged and silently skipped):
 *   1. start_param matches ^ref_[A-Z0-9]{8}$ and resolves to a known ref_code.
 *   2. inviter.telegram_id !== current_user.telegram_id  (no self-refer).
 *   3. current_user.referred_by IS NULL                  (no overwrite).
 *   4. inviter.referred_by !== current_user.telegram_id  (no 1-cycle).
 *   5. No cycle of depth ≤ 5 in the referral DAG         (recursive CTE).
 */

const REF_PARAM_RE = /^ref_([A-Z0-9]{8})$/;
const CYCLE_DEPTH = 5;

/**
 * captureReferredBy — apply attribution inside a single DB transaction.
 *
 * @param {object} db          - D1 / better-sqlite3 database handle
 * @param {number} userId      - telegram_id of the current (new) user
 * @param {string} startParam  - raw start_param string from initData
 * @param {number} now         - unix seconds (injectable for testing)
 * @returns {{ captured: boolean, reason?: string }}
 */
export function captureReferredBy(db, userId, startParam, now) {
  const match = REF_PARAM_RE.exec(startParam);
  if (!match) {
    return { captured: false, reason: 'start_param does not match ref_<CODE> format' };
  }
  const code = match[1];

  // Rule 1 — resolve code to an inviter row
  const inviter = queryOne(db, 'SELECT telegram_id, referred_by FROM users WHERE ref_code = ?', [code]);
  if (!inviter) {
    return { captured: false, reason: `ref_code ${code} not found` };
  }

  // Rule 2 — no self-referral
  if (inviter.telegram_id === userId) {
    return { captured: false, reason: 'self-referral rejected' };
  }

  // Rule 3 — only capture once (no overwrite)
  const currentUser = queryOne(db, 'SELECT referred_by FROM users WHERE telegram_id = ?', [userId]);
  if (!currentUser) {
    return { captured: false, reason: 'user row not found' };
  }
  if (currentUser.referred_by !== null && currentUser.referred_by !== undefined) {
    return { captured: false, reason: 'referred_by already set' };
  }

  // Rule 4 — no direct 1-cycle (inviter was referred by current user)
  if (inviter.referred_by === userId) {
    return { captured: false, reason: '1-cycle detected: inviter was referred by current user' };
  }

  // Rule 5 — cycle check up to depth CYCLE_DEPTH via recursive CTE
  if (hasCycle(db, userId, inviter.telegram_id, CYCLE_DEPTH)) {
    return { captured: false, reason: `cycle detected within depth ${CYCLE_DEPTH}` };
  }

  // Stamp the ledger row with the rate config in effect (#184).
  const configId = activeConfigId(db, now);

  // All checks passed — persist attribution and audit ledger row in a transaction
  execTransaction(db, () => {
    exec(db, 'UPDATE users SET referred_by = ? WHERE telegram_id = ?', [inviter.telegram_id, userId]);

    exec(db,
      `INSERT INTO point_ledger (user_id, swap_id, role, delta_points, memo, config_id, created_at)
       VALUES (?, NULL, 'admin_grant', 0, ?, ?, ?)`,
      [userId, `referral_captured:${inviter.telegram_id}`, configId, now],
    );
  });

  return { captured: true };
}

/**
 * hasCycle — returns true if following referred_by from `startId` ever
 * reaches `targetId` within `maxDepth` hops.
 *
 * Uses a recursive CTE so the DB engine handles the traversal.
 */
function hasCycle(db, targetId, startId, maxDepth) {
  const sql = `
    WITH RECURSIVE chain(node, depth) AS (
      SELECT referred_by, 1
        FROM users
       WHERE telegram_id = ?
      UNION ALL
      SELECT u.referred_by, c.depth + 1
        FROM users u
        JOIN chain c ON u.telegram_id = c.node
       WHERE c.node IS NOT NULL
         AND c.depth < ?
    )
    SELECT 1 AS found FROM chain WHERE node = ? LIMIT 1
  `;
  const row = queryOne(db, sql, [startId, maxDepth, targetId]);
  return row !== null && row !== undefined;
}

// ---------------------------------------------------------------------------
// Thin DB adapters — abstract over D1 (async) vs better-sqlite3 (sync).
// In production (Cloudflare Worker) these would be async; tests use sync.
// ---------------------------------------------------------------------------

/**
 * activeConfigId — id of the active program_config row (latest effective_at <= now),
 * or null when none exists. Best-effort: if the program_config table has not been
 * migrated yet the lookup is swallowed and we return null (the column is nullable,
 * so the ledger write must never fail because of audit metadata). See issue #184.
 */
function activeConfigId(db, now) {
  try {
    const row = queryOne(
      db,
      'SELECT id FROM program_config WHERE effective_at <= ? ORDER BY effective_at DESC LIMIT 1',
      [now],
    );
    return row && row.id != null ? Number(row.id) : null;
  } catch {
    return null;
  }
}

function queryOne(db, sql, params) {
  if (typeof db.prepare === 'function') {
    // better-sqlite3 (sync)
    return db.prepare(sql).get(...params) ?? null;
  }
  throw new Error('unsupported db type');
}

function exec(db, sql, params) {
  if (typeof db.prepare === 'function') {
    db.prepare(sql).run(...params);
    return;
  }
  throw new Error('unsupported db type');
}

function execTransaction(db, fn) {
  if (typeof db.transaction === 'function') {
    // better-sqlite3 transactions
    db.transaction(fn)();
    return;
  }
  throw new Error('unsupported db type');
}
