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
