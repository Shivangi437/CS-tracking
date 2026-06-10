/**
 * Sync orchestrator: Freshdesk → Postgres.
 *
 *  1. Insert a running sync_log row.
 *  2. Resolve the watermark (last successful sync's watermark or now - BACKFILL_DAYS).
 *  3. Sync agents (mark AI based on env).
 *  4. Stream ticket pages updated since the watermark; for each:
 *       - upsert tickets (skip spam/deleted)
 *       - in parallel (p-limit), fetch conversations for changed tickets
 *       - upsert replies idempotently, classifying is_ai
 *  5. Update sync_log → success.
 *  6. Trigger rollup recompute for affected IST dates (M3 fills in the math).
 */

import pLimit from "p-limit";
import { sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { subDays } from "date-fns";

import { db } from "@/lib/db/client";
import { agents, tickets, ticketReplies, syncLog } from "@/lib/db/schema";
import {
  iterateTicketsUpdatedSince,
  listAgents,
  listConversations,
  FreshdeskTicket,
} from "@/lib/freshdesk";
import { env } from "@/lib/env";
import {
  BACKFILL_DAYS,
  FRESHDESK_CONCURRENCY,
  TIMEZONE,
} from "@/lib/config";
import { recomputeRollups } from "@/lib/rollups";

export interface SyncResult {
  syncLogId: number;
  ticketsSynced: number;
  agentsSynced: number;
  repliesUpserted: number;
  affectedDates: string[];
  watermarkFrom: string;
  watermarkTo: string;
  durationMs: number;
}

/**
 * Thrown when a sync is short-circuited because another one is already
 * in-flight. Callers can recognise this and treat it as a soft no-op.
 */
export class SyncBusyError extends Error {
  constructor(public runningSyncId: number, public runningSinceSeconds: number) {
    super(
      `Another sync (#${runningSyncId}) started ${runningSinceSeconds}s ago — skipping.`
    );
    this.name = "SyncBusyError";
  }
}

/** Maximum age (seconds) for a 'running' row before we sweep it as failure. */
const STUCK_SYNC_AGE_SECONDS = 5 * 60; // 5 min
/** If a 'running' row is younger than this, we consider another sync in flight. */
const SINGLE_FLIGHT_AGE_SECONDS = 90;

export async function runSync(): Promise<SyncResult> {
  const startedAt = new Date();

  // ---- 1. Sweep stale running rows ----
  // Vercel functions get killed at 60s. Any 'running' row older than that
  // is almost certainly dead; left alone they pile up and pollute queries.
  await db.execute(sql`
    UPDATE sync_log
    SET status = 'failure',
        finished_at = NOW(),
        error = COALESCE(error, '') ||
                CASE WHEN COALESCE(error, '') = '' THEN '' ELSE ' · ' END ||
                'stale running row swept on next sync start'
    WHERE status = 'running'
      AND started_at < NOW() - INTERVAL '${sql.raw(STUCK_SYNC_AGE_SECONDS.toString())} seconds'
  `);

  // ---- 2. Single-flight check ----
  // If another sync started in the last SINGLE_FLIGHT_AGE_SECONDS, skip.
  // Lets AutoSync from 10 teammates dispatch in parallel without firing 10
  // concurrent syncs against Freshdesk.
  const inFlight = await db
    .select({
      id: syncLog.id,
      startedAt: syncLog.startedAt,
    })
    .from(syncLog)
    .where(
      sql`${syncLog.status} = 'running' AND ${syncLog.startedAt} > NOW() - INTERVAL '${sql.raw(SINGLE_FLIGHT_AGE_SECONDS.toString())} seconds'`
    )
    .limit(1);

  if (inFlight.length > 0) {
    const ageSec = Math.round(
      (Date.now() - new Date(inFlight[0].startedAt).getTime()) / 1000
    );
    throw new SyncBusyError(inFlight[0].id, ageSec);
  }

  const [{ id: syncLogId }] = await db
    .insert(syncLog)
    .values({ status: "running" })
    .returning({ id: syncLog.id });

  try {
    const watermarkFrom = await resolveWatermark();
    const aiIds = new Set(env.AI_AGENT_IDS);
    const affected = new Set<string>();

    const agentsSynced = await syncAgents(aiIds);

    let ticketsSynced = 0;
    let repliesUpserted = 0;
    let pageMaxUpdatedAt: Date | null = null;
    const limiter = pLimit(FRESHDESK_CONCURRENCY);

    for await (const page of iterateTicketsUpdatedSince(watermarkFrom)) {
      const keep = page.filter((t) => !t.spam && !t.deleted);
      if (keep.length === 0) continue;

      await upsertTickets(keep);
      ticketsSynced += keep.length;

      // Advance the per-page watermark as we go. If the function is killed
      // mid-sync (e.g. Vercel 60s timeout), the next invocation resumes
      // from here instead of re-fetching the same window forever.
      const pageMaxRaw = keep.reduce(
        (acc, t) => (acc > t.updated_at ? acc : t.updated_at),
        keep[0].updated_at
      );
      pageMaxUpdatedAt = new Date(pageMaxRaw);

      // Track affected IST dates for the rollup step.
      for (const t of keep) {
        affected.add(toIstDate(t.updated_at));
        affected.add(toIstDate(t.created_at));
        const ra = t.stats?.resolved_at;
        if (ra) affected.add(toIstDate(ra));
      }

      // Fetch conversations in parallel (capped). Per-ticket try/catch so
      // one transient Freshdesk hiccup doesn't poison the whole sync.
      const replyCounts = await Promise.all(
        keep.map((t) =>
          limiter(async () => {
            try {
              const convs = await listConversations(t.id);
              return await upsertRepliesForTicket(t.id, convs, aiIds);
            } catch (err) {
              console.error(
                `[sync] ticket ${t.id} conversation fetch failed:`,
                err instanceof Error ? err.message : err
              );
              return 0;
            }
          })
        )
      );
      repliesUpserted += replyCounts.reduce((a, b) => a + b, 0);

      // Persist partial progress + advancing watermark so a crash mid-
      // backfill still leaves an honest count in sync_log AND the next
      // sync resumes from where this one stopped (see resolveWatermark).
      await db
        .update(syncLog)
        .set({ ticketsSynced, watermark: pageMaxUpdatedAt })
        .where(sql`${syncLog.id} = ${syncLogId}`);
    }

    // Watermark for the *next* run = this sync's start time (safe overlap;
    // upserts are idempotent). Stored on the sync_log row.
    await db
      .update(syncLog)
      .set({
        status: "success",
        finishedAt: new Date(),
        ticketsSynced,
        watermark: startedAt,
      })
      .where(sql`${syncLog.id} = ${syncLogId}`);

    // Recompute rollups for affected days (M3).
    const affectedDates = [...affected].sort();
    if (affectedDates.length > 0) {
      await recomputeRollups(affectedDates);
    }

    return {
      syncLogId,
      ticketsSynced,
      agentsSynced,
      repliesUpserted,
      affectedDates,
      watermarkFrom: watermarkFrom.toISOString(),
      watermarkTo: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(syncLog)
      .set({
        status: "failure",
        finishedAt: new Date(),
        error: message,
      })
      .where(sql`${syncLog.id} = ${syncLogId}`);
    throw err;
  }
}

/**
 * Resolve the starting point for this sync. Strategy:
 *
 *  1. Take the most recent watermark across ALL sync rows (success or
 *     failure). Since we now advance the watermark per page during the run,
 *     a killed-mid-sync row's watermark still represents real progress —
 *     resuming from it is correct and avoids re-fetching the same window.
 *  2. If nothing has ever recorded a watermark, fall back to a 30-day
 *     backfill window.
 *
 * Pre-fix history: we only honoured 'success' rows, so a string of timed-out
 * 'failure' rows blocked the watermark from advancing at all and we'd
 * happily re-do the same too-large window every time.
 */
async function resolveWatermark(): Promise<Date> {
  const last = await db
    .select({ watermark: syncLog.watermark })
    .from(syncLog)
    .where(sql`${syncLog.watermark} IS NOT NULL`)
    .orderBy(sql`${syncLog.watermark} DESC`)
    .limit(1);

  if (last.length > 0 && last[0].watermark) {
    return last[0].watermark;
  }
  return subDays(new Date(), BACKFILL_DAYS);
}

async function syncAgents(aiIds: Set<number>): Promise<number> {
  const list = await listAgents();
  if (list.length === 0) return 0;

  const now = new Date();
  const rows = list.map((a) => ({
    id: a.id,
    name: a.contact?.name ?? `agent-${a.id}`,
    email: a.contact?.email ?? null,
    isAi: aiIds.has(a.id),
    active: true,
    lastSyncedAt: now,
  }));

  await db
    .insert(agents)
    .values(rows)
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: sql`excluded.name`,
        email: sql`excluded.email`,
        isAi: sql`excluded.is_ai`,
        active: sql`excluded.active`,
        lastSyncedAt: sql`excluded.last_synced_at`,
      },
    });

  return rows.length;
}

async function upsertTickets(batch: FreshdeskTicket[]): Promise<void> {
  const now = new Date();
  const rows = batch.map((t) => ({
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    responderId: t.responder_id,
    groupId: t.group_id,
    createdAt: parseDate(t.created_at),
    updatedAt: parseDate(t.updated_at),
    resolvedAt: parseDate(t.stats?.resolved_at),
    firstRespondedAt: parseDate(t.stats?.first_responded_at),
    reopenedAt: parseDate(t.stats?.reopened_at),
    spam: !!t.spam,
    deleted: !!t.deleted,
    lastSyncedAt: now,
  }));

  await db
    .insert(tickets)
    .values(rows)
    .onConflictDoUpdate({
      target: tickets.id,
      set: {
        subject: sql`excluded.subject`,
        status: sql`excluded.status`,
        priority: sql`excluded.priority`,
        responderId: sql`excluded.responder_id`,
        groupId: sql`excluded.group_id`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
        resolvedAt: sql`excluded.resolved_at`,
        firstRespondedAt: sql`excluded.first_responded_at`,
        reopenedAt: sql`excluded.reopened_at`,
        spam: sql`excluded.spam`,
        deleted: sql`excluded.deleted`,
        lastSyncedAt: sql`excluded.last_synced_at`,
      },
    });
}

async function upsertRepliesForTicket(
  ticketId: number,
  convs: Awaited<ReturnType<typeof listConversations>>,
  aiIds: Set<number>
): Promise<number> {
  // Only public outgoing entries count as agent replies (AI or human).
  const replies = convs.filter((c) => c.incoming === false && c.private === false);
  if (replies.length === 0) return 0;

  const rows = replies.map((c) => ({
    ticketId,
    conversationId: c.id,
    agentId: c.user_id,
    isAi: c.user_id != null && aiIds.has(c.user_id),
    isPublic: true,
    repliedAt: parseDate(c.created_at)!,
  }));

  await db.insert(ticketReplies).values(rows).onConflictDoNothing({
    target: [ticketReplies.ticketId, ticketReplies.conversationId],
  });

  return rows.length;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIstDate(iso: string): string {
  return formatInTimeZone(new Date(iso), TIMEZONE, "yyyy-MM-dd");
}
