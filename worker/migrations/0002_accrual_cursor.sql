-- Migration 0002: accrual job cursor and index
-- Adds finished_at index to swaps for cursor-based polling
-- Target: Cloudflare D1 (SQLite)

-- Enables efficient cursor-based polling: WHERE finished_at > ? ORDER BY finished_at
CREATE INDEX IF NOT EXISTS idx_swaps_finished_at ON swaps(finished_at);

-- Enables quick "has this swap been accrued?" check in the job
CREATE INDEX IF NOT EXISTS idx_swaps_status ON swaps(status);
