-- Case-insensitive unique on team_members.name.
--
-- The previous index (0003_lovely_king_cobra.sql) was case-sensitive,
-- so "Karan" and "karan" could both be inserted. The application-layer
-- check claimed case-insensitive uniqueness but the DB didn't enforce
-- it; the audit caught the drift.

DROP INDEX IF EXISTS "team_members_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_name_idx" ON "team_members" (LOWER("name"));
