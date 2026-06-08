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

export async function runSync(): Promise<SyncResult> {
  const startedAt = new Date();

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
    const limiter = pLimit(FRESHDESK_CONCURRENCY);

    for await (const page of iterateTicketsUpdatedSince(watermarkFrom)) {
      const keep = page.filter((t) => !t.spam && !t.deleted);
      if (keep.length === 0) continue;

      await upsertTickets(keep);
      ticketsSynced += keep.length;

      // Track affected IST dates for the rollup step.
      for (const t of keep) {
        affected.add(toIstDate(t.updated_at));
        affected.add(toIstDate(t.created_at));
        const ra = t.stats?.resolved_at;
        if (ra) affected.add(toIstDate(ra));
      }

      // Fetch conversations in parallel (capped).
      const replyCounts = await Promise.all(
        keep.map((t) =>
          limiter(async () => {
            const convs = await listConversations(t.id);
            return upsertRepliesForTicket(t.id, convs, aiIds);
          })
        )
      );
      repliesUpserted += replyCounts.reduce((a, b) => a + b, 0);
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

async function resolveWatermark(): Promise<Date> {
  const last = await db
    .select({ watermark: syncLog.watermark })
    .from(syncLog)
    .where(sql`${syncLog.status} = 'success' AND ${syncLog.watermark} IS NOT NULL`)
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
