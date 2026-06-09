/**
 * Read-only typed queries against the rollup tables. The dashboard and the
 * summary jobs both call these — never Freshdesk on page load.
 */

import { sql, desc, eq, and, gte, lte, isNotNull, asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDailyStats,
  agents,
  escalations,
  syncLog,
  tickets,
} from "@/lib/db/schema";
import { env } from "@/lib/env";

export interface LeaderboardRow {
  agentId: number;
  name: string;
  email: string | null;
  assigned: number;
  replied: number;
  resolved: number;
  handled: number;
  passthrough: number;
  open: number;
  score: number;
}

export interface PeriodTotals {
  assigned: number;
  replied: number;
  resolved: number;
  handled: number;
  passthrough: number;
  open: number;
}

export interface PeriodReport {
  start: string;
  end: string;
  rows: LeaderboardRow[];
  totals: PeriodTotals;
  topPerformer: LeaderboardRow | null;
  lastSyncedAt: Date | null;
}

/**
 * Aggregates agent_daily_stats over [start, end] (both inclusive, IST dates)
 * for every active human executive (excluding Rama). Empty execs are still
 * returned with zeros so they appear on the leaderboard.
 */
export async function getPeriodReport(
  start: string,
  end: string
): Promise<PeriodReport> {
  const ramaId = env.RAMA_AGENT_ID;

  const rows = await db
    .select({
      agentId: agents.id,
      name: agents.name,
      email: agents.email,
      assigned: sql<number>`COALESCE(SUM(${agentDailyStats.assignedCount}), 0)::int`,
      replied: sql<number>`COALESCE(SUM(${agentDailyStats.repliedCount}), 0)::int`,
      resolved: sql<number>`COALESCE(SUM(${agentDailyStats.resolvedCount}), 0)::int`,
      handled: sql<number>`COALESCE(SUM(${agentDailyStats.handledCount}), 0)::int`,
      passthrough: sql<number>`COALESCE(SUM(${agentDailyStats.passthroughCount}), 0)::int`,
      // Open is a current-state snapshot; take the max across rebuilt rows so
      // we always show the freshest value.
      open: sql<number>`COALESCE(MAX(${agentDailyStats.openCount}), 0)::int`,
    })
    .from(agents)
    .leftJoin(
      agentDailyStats,
      and(
        eq(agentDailyStats.agentId, agents.id),
        gte(agentDailyStats.date, start),
        lte(agentDailyStats.date, end)
      )
    )
    .where(
      and(
        eq(agents.active, true),
        eq(agents.isAi, false),
        ramaId ? sql`${agents.id} <> ${ramaId}` : sql`TRUE`
      )
    )
    .groupBy(agents.id, agents.name, agents.email);

  // Recompute score over the *period* (not the per-day score), so weekly
  // ranking reflects weekly normalisation.
  const maxReplied = Math.max(0, ...rows.map((r) => r.replied));
  const maxHandled = Math.max(0, ...rows.map((r) => r.handled));

  const scored: LeaderboardRow[] = rows
    .map((r) => {
      const repliedN = maxReplied > 0 ? r.replied / maxReplied : 0;
      const handledN = maxHandled > 0 ? r.handled / maxHandled : 0;
      const score = 0.5 * repliedN + 0.5 * handledN;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score || b.replied - a.replied);

  const totals: PeriodTotals = scored.reduce(
    (acc, r) => ({
      assigned: acc.assigned + r.assigned,
      replied: acc.replied + r.replied,
      resolved: acc.resolved + r.resolved,
      handled: acc.handled + r.handled,
      passthrough: acc.passthrough + r.passthrough,
      open: acc.open + r.open,
    }),
    { assigned: 0, replied: 0, resolved: 0, handled: 0, passthrough: 0, open: 0 }
  );

  const lastSyncedAt = await getLastSyncedAt();
  const top = scored.find((r) => r.replied + r.handled > 0) ?? null;

  return {
    start,
    end,
    rows: scored,
    totals,
    topPerformer: top,
    lastSyncedAt,
  };
}

export async function getLastSyncedAt(): Promise<Date | null> {
  const r = await db
    .select({ finishedAt: syncLog.finishedAt })
    .from(syncLog)
    .where(and(eq(syncLog.status, "success"), isNotNull(syncLog.finishedAt)))
    .orderBy(desc(syncLog.finishedAt))
    .limit(1);
  return r[0]?.finishedAt ?? null;
}

/** Has *any* sync (success or failure) ever run? Used to render empty state. */
export async function hasAnySync(): Promise<boolean> {
  const r = await db.select({ id: syncLog.id }).from(syncLog).limit(1);
  return r.length > 0;
}

export interface AgentDailySeriesPoint {
  date: string;
  assigned: number;
  replied: number;
  resolved: number;
  handled: number;
  passthrough: number;
}

export async function getAgentDailySeries(
  agentId: number,
  start: string,
  end: string
): Promise<AgentDailySeriesPoint[]> {
  const rows = await db
    .select({
      date: agentDailyStats.date,
      assigned: agentDailyStats.assignedCount,
      replied: agentDailyStats.repliedCount,
      resolved: agentDailyStats.resolvedCount,
      handled: agentDailyStats.handledCount,
      passthrough: agentDailyStats.passthroughCount,
    })
    .from(agentDailyStats)
    .where(
      and(
        eq(agentDailyStats.agentId, agentId),
        gte(agentDailyStats.date, start),
        lte(agentDailyStats.date, end)
      )
    )
    .orderBy(agentDailyStats.date);

  return rows.map((r) => ({
    date: r.date,
    assigned: r.assigned,
    replied: r.replied,
    resolved: r.resolved,
    handled: r.handled,
    passthrough: r.passthrough,
  }));
}

export async function getAgentById(agentId: number) {
  const r = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return r[0] ?? null;
}

/**
 * Active human executives, excluding Rama. Used for filters + the agents
 * list page.
 */
export async function listExecutives() {
  const ramaId = env.RAMA_AGENT_ID;
  return db
    .select({
      id: agents.id,
      name: agents.name,
      email: agents.email,
    })
    .from(agents)
    .where(
      and(
        eq(agents.active, true),
        eq(agents.isAi, false),
        ramaId ? sql`${agents.id} <> ${ramaId}` : sql`TRUE`
      )
    )
    .orderBy(agents.name);
}

/**
 * Distinct ticket counts per resolution_class within the period.
 */
export async function getResolutionSplit(
  start: string,
  end: string
): Promise<{ handled: number; passthrough: number; unclassified: number }> {
  const rows = await db
    .select({
      cls: tickets.resolutionClass,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(tickets)
    .where(
      and(
        isNotNull(tickets.resolvedAt),
        sql`((${tickets.resolvedAt} AT TIME ZONE 'Asia/Kolkata')::date) >= ${start}::date`,
        sql`((${tickets.resolvedAt} AT TIME ZONE 'Asia/Kolkata')::date) <= ${end}::date`,
        eq(tickets.spam, false),
        eq(tickets.deleted, false)
      )
    )
    .groupBy(tickets.resolutionClass);

  let handled = 0;
  let passthrough = 0;
  let unclassified = 0;
  for (const r of rows) {
    if (r.cls === "handled") handled += r.n;
    else if (r.cls === "passthrough") passthrough += r.n;
    else unclassified += r.n;
  }
  return { handled, passthrough, unclassified };
}

// ---------- Escalations ----------

/**
 * Per-agent escalation load, matched by display name (the leaderboard's
 * cleaned name). Pure visibility — never folded into the Score in this task.
 */
export interface EscalationLoad {
  resolvedReal: number;
  inProgress: number;
  touchesOnly: number;
}

export async function getEscalationLoadForAgentName(
  name: string
): Promise<EscalationLoad> {
  if (!name.trim()) {
    return { resolvedReal: 0, inProgress: 0, touchesOnly: 0 };
  }
  const r = await db
    .select({
      cls: escalations.creditClass,
      status: escalations.status,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(escalations)
    .where(sql`LOWER(${escalations.agent}) = LOWER(${name.trim()})`)
    .groupBy(escalations.creditClass, escalations.status);

  let resolvedReal = 0;
  let inProgress = 0;
  let touchesOnly = 0;
  for (const row of r) {
    if (row.cls === "merit" && row.status === "resolved") resolvedReal += row.n;
    else if (row.cls === "merit" && row.status === "in_progress")
      inProgress += row.n;
    else touchesOnly += row.n;
  }
  return { resolvedReal, inProgress, touchesOnly };
}

export interface EscalationRow {
  id: number;
  openedAt: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  channel: string;
  medium: string | null;
  isPublic: boolean;
  authorName: string | null;
  authorEmail: string | null;
  handle: string | null;
  freshdeskTicket: string | null;
  issueText: string | null;
  category: string | null;
  status: string;
  creditClass: string;
  escalationType: string;
  legalThreat: boolean;
  needsAttention: boolean;
  closureConfirmed: boolean;
  remediation: string | null;
  agent: string | null;
  notes: string | null;
}

/**
 * Reputation watchlist: public-facing rows that are still open or just logged,
 * legal threats sorted to the top. The team uses this as the "what's about to
 * embarrass us" view.
 */
export async function getEscalationWatchlist(limit = 50): Promise<EscalationRow[]> {
  return db
    .select({
      id: escalations.id,
      openedAt: escalations.openedAt,
      acknowledgedAt: escalations.acknowledgedAt,
      resolvedAt: escalations.resolvedAt,
      channel: escalations.channel,
      medium: escalations.medium,
      isPublic: escalations.isPublic,
      authorName: escalations.authorName,
      authorEmail: escalations.authorEmail,
      handle: escalations.handle,
      freshdeskTicket: escalations.freshdeskTicket,
      issueText: escalations.issueText,
      category: escalations.category,
      status: escalations.status,
      creditClass: escalations.creditClass,
      escalationType: escalations.escalationType,
      legalThreat: escalations.legalThreat,
      needsAttention: escalations.needsAttention,
      closureConfirmed: escalations.closureConfirmed,
      remediation: escalations.remediation,
      agent: escalations.agent,
      notes: escalations.notes,
    })
    .from(escalations)
    .where(
      and(
        eq(escalations.isPublic, true),
        sql`${escalations.status} IN ('open_unactioned','in_progress','unlogged')`
      )
    )
    .orderBy(
      desc(escalations.legalThreat),
      sql`${escalations.openedAt} NULLS FIRST`
    )
    .limit(limit);
}

export interface ListEscalationsFilters {
  channel?: string;
  status?: string;
  agent?: string;
  isPublic?: boolean;
  needsAttention?: boolean;
}

/**
 * Filterable escalations list — newest first. Empty filters = everything.
 */
export async function listEscalations(
  filters: ListEscalationsFilters = {},
  limit = 500
): Promise<EscalationRow[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (filters.channel) conds.push(eq(escalations.channel, filters.channel));
  if (filters.status) conds.push(eq(escalations.status, filters.status));
  if (filters.agent)
    conds.push(sql`LOWER(${escalations.agent}) = LOWER(${filters.agent})` as ReturnType<typeof eq>);
  if (filters.isPublic !== undefined)
    conds.push(eq(escalations.isPublic, filters.isPublic));
  if (filters.needsAttention !== undefined)
    conds.push(eq(escalations.needsAttention, filters.needsAttention));

  return db
    .select({
      id: escalations.id,
      openedAt: escalations.openedAt,
      acknowledgedAt: escalations.acknowledgedAt,
      resolvedAt: escalations.resolvedAt,
      channel: escalations.channel,
      medium: escalations.medium,
      isPublic: escalations.isPublic,
      authorName: escalations.authorName,
      authorEmail: escalations.authorEmail,
      handle: escalations.handle,
      freshdeskTicket: escalations.freshdeskTicket,
      issueText: escalations.issueText,
      category: escalations.category,
      status: escalations.status,
      creditClass: escalations.creditClass,
      escalationType: escalations.escalationType,
      legalThreat: escalations.legalThreat,
      needsAttention: escalations.needsAttention,
      closureConfirmed: escalations.closureConfirmed,
      remediation: escalations.remediation,
      agent: escalations.agent,
      notes: escalations.notes,
    })
    .from(escalations)
    .where(conds.length ? and(...conds) : sql`TRUE`)
    .orderBy(sql`${escalations.openedAt} DESC NULLS LAST`, desc(escalations.id))
    .limit(limit);
}

export interface EscalationOverview {
  total: number;
  needsAttention: number;
  publicOpen: number;
  legalThreats: number;
  distinctAgents: { agent: string; n: number }[];
  channelBreakdown: { channel: string; n: number }[];
}

export async function getEscalationOverview(): Promise<EscalationOverview> {
  const [counts, byAgent, byChannel] = await Promise.all([
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        needsAttention: sql<number>`SUM(CASE WHEN ${escalations.needsAttention} THEN 1 ELSE 0 END)::int`,
        publicOpen: sql<number>`SUM(CASE WHEN ${escalations.isPublic} AND ${escalations.status} IN ('open_unactioned','in_progress','unlogged') THEN 1 ELSE 0 END)::int`,
        legalThreats: sql<number>`SUM(CASE WHEN ${escalations.legalThreat} THEN 1 ELSE 0 END)::int`,
      })
      .from(escalations),
    db
      .select({
        agent: escalations.agent,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(escalations)
      .where(isNotNull(escalations.agent))
      .groupBy(escalations.agent)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(20),
    db
      .select({
        channel: escalations.channel,
        n: sql<number>`COUNT(*)::int`,
      })
      .from(escalations)
      .groupBy(escalations.channel)
      .orderBy(desc(sql`COUNT(*)`)),
  ]);

  return {
    total: counts[0]?.total ?? 0,
    needsAttention: counts[0]?.needsAttention ?? 0,
    publicOpen: counts[0]?.publicOpen ?? 0,
    legalThreats: counts[0]?.legalThreats ?? 0,
    distinctAgents: byAgent
      .filter((r): r is { agent: string; n: number } => r.agent != null)
      .map((r) => ({ agent: r.agent, n: r.n })),
    channelBreakdown: byChannel.map((r) => ({ channel: r.channel, n: r.n })),
  };
}

/** Distinct agents that ever appear in escalations — for filter dropdowns. */
export async function listEscalationAgents(): Promise<string[]> {
  const r = await db
    .selectDistinct({ agent: escalations.agent })
    .from(escalations)
    .where(isNotNull(escalations.agent))
    .orderBy(asc(escalations.agent));
  return r.map((x) => x.agent!).filter(Boolean);
}
