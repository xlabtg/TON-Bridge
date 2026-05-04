-- Migration 0001: affiliate program data model
-- Tables: users, swaps, point_ledger, redemptions
-- Target: Cloudflare D1 (SQLite)

CREATE TABLE users (
  telegram_id  INTEGER PRIMARY KEY,
  ref_code     TEXT UNIQUE NOT NULL,
  referred_by  INTEGER REFERENCES users(telegram_id),
  ton_address  TEXT,                          -- set in #6.9
  created_at   INTEGER NOT NULL,              -- unix seconds
  last_seen    INTEGER NOT NULL,
  opt_out_leaderboard INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE swaps (
  id              TEXT PRIMARY KEY,           -- ChangeNOW partner_txn_id
  user_id         INTEGER NOT NULL REFERENCES users(telegram_id),
  from_currency   TEXT NOT NULL,
  to_currency     TEXT NOT NULL,
  from_amount     REAL NOT NULL,
  to_amount       REAL,
  turnover_usd    REAL NOT NULL,              -- locked at finished-time, see #6.4
  usd_rate_source TEXT NOT NULL,
  status          TEXT NOT NULL,              -- new|waiting|confirming|exchanging|sending|finished|failed|refunded
  created_at      INTEGER NOT NULL,
  finished_at     INTEGER
);

CREATE TABLE point_ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(telegram_id),
  swap_id      TEXT REFERENCES swaps(id),
  role         TEXT NOT NULL,                 -- trader|referrer|admin_grant|redemption
  delta_points INTEGER NOT NULL,              -- positive=credit, negative=debit
  rate_bps     INTEGER,                       -- bps applied (cashback or referral)
  memo         TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE redemptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  points_spent  INTEGER NOT NULL,
  tbc_amount    INTEGER NOT NULL,             -- 1 TBC = 10 points
  status        TEXT NOT NULL,                -- requested|paid|failed
  on_chain_tx   TEXT,
  created_at    INTEGER NOT NULL,
  settled_at    INTEGER
);

CREATE INDEX idx_swaps_user ON swaps(user_id);
CREATE INDEX idx_ledger_user ON point_ledger(user_id);
CREATE UNIQUE INDEX uq_ledger_swap_role ON point_ledger(swap_id, role)  -- idempotency
  WHERE swap_id IS NOT NULL;

-- Aggregated view: current points balance and lifetime turnover per user.
-- point_ledger is append-only; reversals use negative delta_points rows.
CREATE VIEW user_balances AS
SELECT
  u.telegram_id                    AS user_id,
  COALESCE(SUM(l.delta_points), 0) AS points,
  COALESCE(SUM(
    CASE WHEN s.status = 'finished' THEN s.turnover_usd ELSE 0 END
  ), 0)                            AS lifetime_turnover_usd
FROM users u
LEFT JOIN point_ledger l ON l.user_id = u.telegram_id
LEFT JOIN swaps s        ON s.user_id = u.telegram_id
GROUP BY u.telegram_id;
