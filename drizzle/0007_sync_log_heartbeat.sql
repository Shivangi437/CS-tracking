-- Add a progress heartbeat to sync_log so the stale-sweep can tell a long-
-- but-progressing sync apart from a Vercel-killed zombie.
--
-- Before: sweeps fired on `started_at < now() - 90s`, which falsely killed
-- ANY sync running longer than 90s (rate-limited catch-up syncs routinely
-- do). That released the single-flight lock mid-run and risked a second
-- concurrent sync breaching Freshdesk's rate limit.
--
-- After: runSync bumps last_progress_at on every chunk commit, and the
-- sweeps key off COALESCE(last_progress_at, started_at) instead.

ALTER TABLE "sync_log" ADD COLUMN IF NOT EXISTS "last_progress_at" timestamptz NOT NULL DEFAULT now();
