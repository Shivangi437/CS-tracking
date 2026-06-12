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
import { sql, eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { subDays } from "date-fns";

/**
 * Postgres unique_violation. Thrown when our INSERT of a 'running'
 * sync_log row hits the partial unique index because another sync is
 * already running.
 */
function isUniqueViolation(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  if (e.code === "23505") return true;
  if (e.cause?.code === "23505") return true;
  if (typeof e.message === "string" && e.message.includes("23505")) return true;
  if (
    typeof e.message === "string" &&
    e.message.includes("sync_log_only_one_running_idx")
  )
    return true;
  return false;
}

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

  // ---- 2. Single-flight via DB-enforced unique constraint ----
  //
  // Postgres has a partial unique index: sync_log(status) WHERE status='running'.
  // That guarantees globally — across every Vercel function instance, CLI
  // run, and concurrent trigger — that at most ONE row may be in 'running'
  // state at a time. The in-memory token bucket only paces requests WITHIN
  // one process; without this DB lock, several cold-started Vercel
  // instances could each run their own 60/min bucket in parallel,
  // collectively breaching Freshdesk's 100/min ceiling and stealing
  // budget from the AI bot.
  //
  // The old "look-back 90 seconds" SELECT-then-INSERT pattern has a race
  // window where two SELECTs both see 'no other running' before either
  // INSERTs. The unique constraint closes that race atomically.
  //
  // A peek-first for a friendlier error message; the index itself is
  // what actually guarantees mutual exclusion.
  const inFlightPeek = await db
    .select({ id: syncLog.id, startedAt: syncLog.startedAt })
    .from(syncLog)
    .where(eq(syncLog.status, "running"))
    .limit(1);

  let syncLogId: number;
  try {
    const inserted = await db
      .insert(syncLog)
      .values({ status: "running" })
      .returning({ id: syncLog.id });
    syncLogId = inserted[0].id;
  } catch (err) {
    // Postgres 23505 = unique_violation. Means another sync claimed the
    // running slot between our peek and our insert (race window the
    // unique index just closed).
    if (isUniqueViolation(err)) {
      const ageSec = inFlightPeek[0]
        ? Math.round(
            (Date.now() - new Date(inFlightPeek[0].startedAt).getTime()) / 1000
          )
        : 0;
      throw new SyncBusyError(inFlightPeek[0]?.id ?? 0, ageSec);
    }
    throw err;
  }

  if (inFlightPeek.length > 0) {
    // We peeked a running row but somehow our insert succeeded — this
    // means the running row was old enough that the stale-sweep took it
    // out from under us. Fine, our row is the live one now. Continue.
  }

  // Belt-and-braces: a younger-than-SINGLE_FLIGHT_AGE_SECONDS row that
  // happens to share status='running' with us shouldn't exist after the
  // unique index, but the check survives to surface intent in code.
  void SINGLE_FLIGHT_AGE_SECONDS;

  try {
    const watermarkFrom = await resolveWatermark();
    const aiIds = new Set(env.AI_AGENT_IDS);
    const affected = new Set<string>();

    const agentsSynced = await syncAgents(aiIds);

    let ticketsSynced = 0;
    let repliesUpserted = 0;
    let pageMaxUpdatedAt: Date | null = null;
    const limiter = pLimit(FRESHDESK_CONCURRENCY);

    // Process each page in CHUNK-sized batches so progress survives a
    // Vercel 60s function kill. At the token bucket's 60 req/min cap, a
    // full 100-ticket page can't fit in 60s (needs ~100 sec). With chunks
    // of 30 (~30 sec per chunk), each Vercel call drains 1-2 chunks and
    // the next call resumes after a chunk boundary, not from the page
    // start.
    const CHUNK_SIZE = 30;

    for await (const page of iterateTicketsUpdatedSince(watermarkFrom)) {
      const keep = page.filter((t) => !t.spam && !t.deleted);
      if (keep.length === 0) continue;

      // Persist the ticket rows up-front in one bulk write — cheap, and
      // means a kill leaves the ticket data correct even if the
      // conversation fetches haven't finished.
      await upsertTickets(keep);
      ticketsSynced += keep.length;

      // Sort by updated_at ASC so chunk-by-chunk watermark advance is
      // monotonic — each chunk's MAX(updated_at) is strictly ≥ the
      // previous chunk's MAX, so resuming from there never re-processes
      // a completed chunk.
      const sorted = [...keep].sort((a, b) =>
        a.updated_at.localeCompare(b.updated_at)
      );

      for (let i = 0; i < sorted.length; i += CHUNK_SIZE) {
        const chunkSlice = sorted.slice(i, i + CHUNK_SIZE);

        // Fetch conversations in parallel within the chunk (capped). Per-
        // ticket try/catch so one transient Freshdesk hiccup doesn't
        // poison the whole chunk.
        const replyCounts = await Promise.all(
          chunkSlice.map((t) =>
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

        // Affected IST dates for THIS chunk — rolled up immediately so
        // partial progress always has fresh dashboard numbers.
        const chunkDates = new Set<string>();
        for (const t of chunkSlice) {
          const u = toIstDate(t.updated_at);
          const c = toIstDate(t.created_at);
          const r = t.stats?.resolved_at ? toIstDate(t.stats.resolved_at) : null;
          chunkDates.add(u); affected.add(u);
          chunkDates.add(c); affected.add(c);
          if (r) { chunkDates.add(r); affected.add(r); }
        }

        // Recompute rollups for this chunk's dates BEFORE advancing the
        // watermark. Invariant: once watermark passes a chunk, the
        // dashboard's rollup for those dates already reflects this
        // chunk's data. Cheap (per-date upserts), idempotent (re-running
        // on the same dates is harmless), and means a kill mid-page
        // never leaves dates with stale rollups.
        if (chunkDates.size > 0) {
          await recomputeRollups([...chunkDates]).catch((err) => {
            console.error(
              "[sync] chunk rollup failed:",
              err instanceof Error ? err.message : err
            );
          });
        }

        // Advance watermark to the chunk's MAX(updated_at). Combined with
        // the sort above this is monotonic — the next sync resumes here.
        pageMaxUpdatedAt = new Date(chunkSlice[chunkSlice.length - 1].updated_at);

        await db
          .update(syncLog)
          .set({ ticketsSynced, watermark: pageMaxUpdatedAt })
          .where(sql`${syncLog.id} = ${syncLogId}`);
      }
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
