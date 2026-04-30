-- Phase 6 affiliate data model
-- users: one row per Telegram account
CREATE TABLE IF NOT EXISTS users (
    telegram_id        INTEGER PRIMARY KEY,
    ref_code           TEXT    NOT NULL UNIQUE,
    referred_by        INTEGER REFERENCES users(telegram_id),
    ton_address        TEXT,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    last_seen          TEXT    NOT NULL DEFAULT (datetime('now')),
    opt_out_leaderboard INTEGER NOT NULL DEFAULT 0
);

-- swaps: completed ChangeNOW transactions attributed to a user
CREATE TABLE IF NOT EXISTS swaps (
    id              TEXT    PRIMARY KEY,  -- partner_txn_id from ChangeNOW
    user_id         INTEGER NOT NULL REFERENCES users(telegram_id),
    from_currency   TEXT,
    to_currency     TEXT,
    from_amount     REAL,
    to_amount       REAL,
    turnover_usd    REAL    NOT NULL DEFAULT 0,
    usd_rate_source TEXT,
    status          TEXT    NOT NULL DEFAULT 'finished',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT
);

-- point_ledger: append-only credits/debits; balances always reconstructible
CREATE TABLE IF NOT EXISTS point_ledger (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(telegram_id),
    swap_id      TEXT    REFERENCES swaps(id),
    role         TEXT    NOT NULL CHECK(role IN ('trader','referrer','admin_grant','redemption')),
    delta_points INTEGER NOT NULL,
    rate_bps     INTEGER,
    memo         TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Idempotency: each (swap, role) pair credited at most once
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_swap_role ON point_ledger(swap_id, role)
    WHERE swap_id IS NOT NULL;

-- redemptions: one row per redemption request
CREATE TABLE IF NOT EXISTS redemptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(telegram_id),
    points_spent INTEGER NOT NULL,
    tbc_amount   INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'requested'
                         CHECK(status IN ('requested','paid','failed','queued')),
    on_chain_tx  TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    settled_at   TEXT
);

-- View: current balance and lifetime turnover per user
CREATE VIEW IF NOT EXISTS user_balances AS
SELECT
    u.telegram_id                  AS user_id,
    COALESCE(SUM(pl.delta_points), 0) AS points,
    COALESCE(SUM(CASE WHEN s.id IS NOT NULL THEN s.turnover_usd ELSE 0 END), 0) AS lifetime_turnover_usd
FROM users u
LEFT JOIN point_ledger pl ON pl.user_id = u.telegram_id
LEFT JOIN swaps        s  ON s.id = pl.swap_id AND pl.role = 'trader'
GROUP BY u.telegram_id;
