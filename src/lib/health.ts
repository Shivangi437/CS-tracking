/**
 * Sync health snapshot. Shared by GET /api/health and the in-layout banner.
 *
 *   ok        — last successful sync less than 20 min old AND no zombies
 *   degraded  — last success 20–60 min old, or there's a stuck sync row
 *   broken    — last success > 60 min old, or never synced
 */

import { sql, desc, and, isNotNull, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syncLog } from "@/lib/db/schema";

/** Seconds before a 'running' row counts as a zombie that needs sweeping. */
const STUCK_SYNC_AGE_SECONDS = 5 * 60;

/**
 * Proactive stale-sweep: mark any 'running' row older than 5 min as failure.
 *
 * The stale-sweep inside runSync() only fires when a new sync attempt
 * comes in. If the GH Actions workflow isn't currently looping and
 * AutoSync is read-only, a zombie 'running' row from a Vercel-killed
 * function can sit forever, blocking the single-flight unique index and
 * tripping the health banner.
 *
 * Running this from /api/health (which fires on every page render +
 * every AutoSync tick) means anyone viewing the dashboard implicitly
 * cleans up zombies. Pure DB UPDATE — no Freshdesk traffic.
 */
async function sweepStuckSyncs(): Promise<number> {
  const r = await db.execute<{ id: number }>(sql`
    UPDATE sync_log
    SET status = 'failure',
        finished_at = NOW(),
        error = COALESCE(error, '') ||
                CASE WHEN COALESCE(error, '') = '' THEN '' ELSE ' · ' END ||
                'stale running row swept by health probe'
    WHERE status = 'running'
      AND started_at < NOW() - INTERVAL '${sql.raw(STUCK_SYNC_AGE_SECONDS.toString())} seconds'
    RETURNING id
  `);
  // neon-http returns { rows: [...] } or the array directly depending on
  // driver version; handle both shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((r as any).rows ?? r) as Array<{ id: number }>;
  return Array.isArray(rows) ? rows.length : 0;
}

export type HealthLevel = "ok" | "degraded" | "broken";

export interface HealthSnapshot {
  level: HealthLevel;
  lastSyncedAt: string | null;
  ageMinutes: number | null;
  runningCount: number;
  stuckCount: number;
  latestError: string | null;
}

export async function getSyncHealth(): Promise<HealthSnapshot> {
  // Self-heal before we report: clear any zombie 'running' rows older
  // than 5 min so the single-flight slot is never permanently held by
  // a Vercel-killed function.
  await sweepStuckSyncs().catch(() => 0);

  const [lastSuccess, runningRows] = await Promise.all([
    db
      .select({
        finishedAt: syncLog.finishedAt,
        error: syncLog.error,
      })
      .from(syncLog)
      .where(and(eq(syncLog.status, "success"), isNotNull(syncLog.finishedAt)))
      .orderBy(desc(syncLog.finishedAt))
      .limit(1),
    db
      .select({
        id: syncLog.id,
        startedAt: syncLog.startedAt,
      })
      .from(syncLog)
      .where(eq(syncLog.status, "running")),
  ]);

  const latestFailure = await db
    .select({ error: syncLog.error, finishedAt: syncLog.finishedAt })
    .from(syncLog)
    .where(eq(syncLog.status, "failure"))
    .orderBy(desc(syncLog.finishedAt))
    .limit(1);

  const lastSyncedAt = lastSuccess[0]?.finishedAt ?? null;
  const ageMinutes = lastSyncedAt
    ? Math.round((Date.now() - new Date(lastSyncedAt).getTime()) / 60000)
    : null;

  const now = Date.now();
  const stuckCount = runningRows.filter(
    (r) => now - new Date(r.startedAt).getTime() > 5 * 60 * 1000
  ).length;
  const runningCount = runningRows.length;

  let level: HealthLevel = "ok";
  if (ageMinutes == null) level = "broken";
  else if (ageMinutes > 60) level = "broken";
  else if (ageMinutes > 20 || stuckCount > 0) level = "degraded";

  return {
    level,
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
    ageMinutes,
    runningCount,
    stuckCount,
    latestError: latestFailure[0]?.error ?? null,
  };
}
