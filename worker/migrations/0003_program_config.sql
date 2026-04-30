-- Migration 0003: program_config table (issue #55 — Phase 6.12)
-- Stores versioned rate-knob snapshots so every point_ledger row
-- can reproduce the exact rates that were active when it was written.
-- Target: Cloudflare D1 (SQLite)

CREATE TABLE program_config (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  service_bps     INTEGER NOT NULL,           -- 0.XX % — informational, set by ChangeNOW partnership
  cashback_bps    INTEGER NOT NULL,           -- trader rebate in basis points
  referral_bps    INTEGER NOT NULL,           -- inviter rebate in basis points
  point_usd_value REAL    NOT NULL,           -- implied $/point (e.g. 0.00003)
  points_per_tbc  INTEGER NOT NULL,           -- redemption divisor (e.g. 10)
  min_redeem_pts  INTEGER NOT NULL,           -- minimum redemption in points (e.g. 100)
  daily_cap_usd   REAL    NOT NULL,           -- anti-fraud per-user daily turnover cap
  proposed_by     TEXT    NOT NULL,           -- 'boot' | 'admin:<telegram_id>'
  effective_at    INTEGER NOT NULL,           -- unix seconds: when this config takes effect
  created_at      INTEGER NOT NULL            -- unix seconds: when the row was inserted
);

-- Only one config is active at any given time: the latest effective_at <= now().
-- This index supports fast lookup of the active config.
CREATE INDEX idx_program_config_effective ON program_config(effective_at);

-- Add config_id FK to point_ledger so each row references the rate set used.
-- SQLite does not support ADD FOREIGN KEY after creation, so we add an integer
-- column and rely on application-level consistency.
ALTER TABLE point_ledger ADD COLUMN config_id INTEGER REFERENCES program_config(id);
