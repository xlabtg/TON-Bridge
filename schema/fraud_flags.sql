-- fraud_flags table — Phase 6 anti-fraud guardrails (issue #50)
--
-- Every guardrail violation or suspicious event is appended here.
-- The table is append-only: rows are never deleted; resolved events are
-- annotated via resolved_at / resolved_by so the full audit trail is preserved.
--
-- Surfaced in the admin dashboard (issue #53 / 6.10).

CREATE TABLE IF NOT EXISTS fraud_flags (
    id           SERIAL PRIMARY KEY,
    user_id      TEXT        NOT NULL,           -- Telegram user_id (string to avoid int overflow)
    reason       TEXT        NOT NULL,           -- machine-readable: 'concentration' | 'cap_exceeded' | 'age_gate' | 'finished_state'
    evidence     JSONB       NOT NULL DEFAULT '{}', -- arbitrary payload for the specific guardrail
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at  TIMESTAMPTZ,                    -- NULL = still open / under review
    resolved_by  TEXT                            -- admin Telegram user_id who resolved
);

-- Speed up the most common admin queries.
CREATE INDEX IF NOT EXISTS fraud_flags_user_id_idx    ON fraud_flags (user_id);
CREATE INDEX IF NOT EXISTS fraud_flags_reason_idx     ON fraud_flags (reason);
CREATE INDEX IF NOT EXISTS fraud_flags_created_at_idx ON fraud_flags (created_at DESC);
CREATE INDEX IF NOT EXISTS fraud_flags_unresolved_idx ON fraud_flags (resolved_at) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Reason codes (reference)
-- ---------------------------------------------------------------------------
-- 'concentration'   Guardrail (c): inviter's 30-day referral turnover is >80 %
--                   from a single referee. evidence: { topRefereeId, concentration,
--                   threshold, totalTurnoverUsd, topRefereeTurnoverUsd, windowDays }
--
-- 'cap_exceeded'    Guardrail (b): a swap pushed the user over the daily turnover
--                   cap and points were partially or fully suppressed. evidence:
--                   { swapId, swapTurnoverUsd, dailyTurnoverBefore, capUsd, unixDay }
--
-- 'age_gate'        Guardrail (d): a withdrawal was attempted while account is
--                   still in the vesting window. evidence: { authDateUnix,
--                   estimatedAgeDays, requiredDays }
--
-- 'finished_state'  Guardrail (a): a referral payout was attempted for a swap
--                   that was not in 'finished' state. evidence: { swapId, status }
