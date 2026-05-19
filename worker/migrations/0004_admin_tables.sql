-- Migration 0004: admin panel data tables (issue #121)
-- Tables: fraud_flags, audit_log
-- Target: Cloudflare D1 (SQLite)
--
-- Backs the admin panel widgets (#121) so they can replace the demo data
-- that previously lived inline in assets/js/admin.js.

CREATE TABLE fraud_flags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  reason        TEXT    NOT NULL,
  amount_points INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,           -- unix seconds
  resolved      INTEGER NOT NULL DEFAULT 0, -- 0|1
  resolved_at   INTEGER,
  resolved_by   INTEGER                     -- telegram_id of admin who resolved
);

CREATE INDEX idx_fraud_flags_resolved_created
  ON fraud_flags(resolved, created_at DESC);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER NOT NULL,             -- telegram_id of the admin who acted
  action      TEXT    NOT NULL,             -- e.g. 'resolve_fraud_flag'
  target      TEXT,                         -- string identifier of the targeted entity
  before_json TEXT,                         -- snapshot before the change
  after_json  TEXT,                         -- snapshot after the change
  created_at  INTEGER NOT NULL              -- unix seconds
);

CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
