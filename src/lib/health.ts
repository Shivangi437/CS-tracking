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

/**
 * Seconds before a 'running' row counts as a zombie that needs sweeping.
 *
 * With chunked-progress watermark advance (every ~30s), any genuinely
 * progressing sync updates sync_log frequently. A row that's >90s old
 * with NO progress is definitively a Vercel-killed zombie. 90s gives
 * Vercel's 60s maxDuration plus a safety margin.
 */
const STUCK_SYNC_AGE_SECONDS = 90;

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
      AND COALESCE(last_progress_at, started_at) < NOW() - INTERVAL '${sql.raw(STUCK_SYNC_AGE_SECONDS.toString())} seconds'
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
  // than 90s so the single-flight slot is never permanently held by
  // a Vercel-killed function.
  await sweepStuckSyncs().catch(() => 0);

  const [latestWatermark, runningRows] = await Promise.all([
    // "Fresh as of" = MAX(watermark) across ALL syncs (success or failure).
    // The chunked-progress fix updates watermark per-chunk after rollups
    // are recomputed, so watermark is the truthful "data on screen is
    // fresh as of" timestamp — not finished_at of the last completed sync.
    db
      .select({ watermark: syncLog.watermark })
      .from(syncLog)
      .where(isNotNull(syncLog.watermark))
      .orderBy(desc(syncLog.watermark))
      .limit(1),
    db
      .select({
        id: syncLog.id,
        startedAt: syncLog.startedAt,
        lastProgressAt: syncLog.lastProgressAt,
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

  const lastSyncedAt = latestWatermark[0]?.watermark ?? null;
  const ageMinutes = lastSyncedAt
    ? Math.round((Date.now() - new Date(lastSyncedAt).getTime()) / 60000)
    : null;

  const now = Date.now();
  const stuckCount = runningRows.filter(
    (r) =>
      now - new Date(r.lastProgressAt ?? r.startedAt).getTime() > 90 * 1000
  ).length;
  const runningCount = runningRows.length;

  // Thresholds tuned to the twice-daily sync schedule (13:00 + 18:00 IST).
  // Worst-case expected gap is overnight: ~19h between the 18:00 sync and
  // the 13:00 next-day sync. We want the banner to stay green during that
  // expected gap and only flag when a sync actually MISSED its slot.
  //
  //   ok        : last sync ≤ 25h ago  (covers the 19h overnight + buffer)
  //   degraded  : 25–36h               (one missed scheduled sync — both
  //                                     13:00 OR both 18:00 didn't run)
  //   broken    : > 36h                (two consecutive missed syncs)
  //
  // Stuck syncs (zombie rows older than 90s with no progress) always
  // count toward degraded regardless of last-sync age — that's a real-
  // time signal that something's wrong now.
  const HOUR_MIN = 60;
  let level: HealthLevel = "ok";
  if (ageMinutes == null) level = "broken";
  else if (ageMinutes > 36 * HOUR_MIN) level = "broken";
  else if (ageMinutes > 25 * HOUR_MIN || stuckCount > 0) level = "degraded";

  return {
    level,
    lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
    ageMinutes,
    runningCount,
    stuckCount,
    latestError: latestFailure[0]?.error ?? null,
  };
}
