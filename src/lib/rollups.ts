/**
 * Daily rollup recompute. Triggered after each sync for the IST dates the
 * sync touched.
 *
 * For every active human executive (excluding the CS manager) on each
 * affected date, compute:
 *   - assigned     distinct tickets responder = exec, IST(created_at) = d
 *                  OR IST(updated_at) = d
 *   - replied      distinct tickets the exec posted ≥1 public human reply on
 *                  with IST(replied_at) = d
 *   - resolved     tickets responder = exec, IST(resolved_at) = d
 *   - handled      resolved AND exec has ≥1 human reply on the ticket
 *   - passthrough  resolved - handled
 *   - open         current snapshot: responder = exec AND status NOT IN
 *                  (Resolved, Closed) — same value across all rebuilt rows
 *   - score        0.5 * norm(replied) + 0.5 * norm(handled), normalised
 *                  across the day's active human execs
 *
 * Also stamps tickets.resolution_class ('handled' | 'passthrough') for every
 * resolved ticket touched by this pass.
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDailyStats } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { SCORE_WEIGHTS, TIMEZONE } from "@/lib/config";

interface AgentDayCounts {
  agentId: number;
  assigned: number;
  replied: number;
  resolved: number;
  handled: number;
  passthrough: number;
  open: number;
}

export async function recomputeRollups(istDates: string[]): Promise<void> {
  if (istDates.length === 0) return;

  const ramaId = env.RAMA_AGENT_ID; // excluded from the leaderboard
  const ramaExclusion = ramaId
    ? sql`AND a.id <> ${ramaId}`
    : sql``;

  for (const date of istDates) {
    const counts = await queryAgentCounts(date, ramaExclusion);
    const scored = scoreAgents(counts);

    if (scored.length === 0) continue;

    await db
      .insert(agentDailyStats)
      .values(
        scored.map((c) => ({
          date,
          agentId: c.agentId,
          assignedCount: c.assigned,
          repliedCount: c.replied,
          resolvedCount: c.resolved,
          handledCount: c.handled,
          passthroughCount: c.passthrough,
          openCount: c.open,
          score: c.score,
        }))
      )
      .onConflictDoUpdate({
        target: [agentDailyStats.date, agentDailyStats.agentId],
        set: {
          assignedCount: sql`excluded.assigned_count`,
          repliedCount: sql`excluded.replied_count`,
          resolvedCount: sql`excluded.resolved_count`,
          handledCount: sql`excluded.handled_count`,
          passthroughCount: sql`excluded.passthrough_count`,
          openCount: sql`excluded.open_count`,
          score: sql`excluded.score`,
        },
      });
  }

  await stampResolutionClass(istDates);
}

/**
 * One query per date: for every active human executive (≠ Rama), compute
 * the six day-bucketed counts plus the current open snapshot.
 */
async function queryAgentCounts(
  date: string,
  ramaExclusion: ReturnType<typeof sql>
): Promise<AgentDayCounts[]> {
  const tz = TIMEZONE;

  const rows = await db.execute<{
    agent_id: number;
    assigned: number;
    replied: number;
    resolved: number;
    handled: number;
    passthrough: number;
    open: number;
  }>(sql`
    WITH execs AS (
      SELECT a.id
      FROM agents a
      WHERE a.active = true
        AND a.is_ai = false
        ${ramaExclusion}
    ),

    /* Distinct tickets the exec posted ≥1 human reply on, with IST(replied_at) = d. */
    replied AS (
      SELECT r.agent_id, COUNT(DISTINCT r.ticket_id)::int AS n
      FROM ticket_replies r
      WHERE r.is_ai = false
        AND r.is_public = true
        AND ((r.replied_at AT TIME ZONE ${tz})::date) = ${date}::date
      GROUP BY r.agent_id
    ),

    /* Tickets currently assigned to the exec that "entered the period"
       — either created or updated on that IST date. */
    assigned AS (
      SELECT t.responder_id AS agent_id, COUNT(DISTINCT t.id)::int AS n
      FROM tickets t
      WHERE t.responder_id IS NOT NULL
        AND t.spam = false AND t.deleted = false
        AND (
              ((t.created_at AT TIME ZONE ${tz})::date) = ${date}::date
           OR ((t.updated_at AT TIME ZONE ${tz})::date) = ${date}::date
        )
      GROUP BY t.responder_id
    ),

    /* Resolved on that IST date, credited to current responder. */
    resolved_tix AS (
      SELECT t.id, t.responder_id AS agent_id
      FROM tickets t
      WHERE t.responder_id IS NOT NULL
        AND t.spam = false AND t.deleted = false
        AND t.resolved_at IS NOT NULL
        AND ((t.resolved_at AT TIME ZONE ${tz})::date) = ${date}::date
    ),

    resolved AS (
      SELECT agent_id, COUNT(*)::int AS n
      FROM resolved_tix
      GROUP BY agent_id
    ),

    /* Handled = resolved tickets where the responder also posted ≥1 human reply
       (at any time, not just on the resolution day). */
    handled AS (
      SELECT rt.agent_id, COUNT(DISTINCT rt.id)::int AS n
      FROM resolved_tix rt
      WHERE EXISTS (
        SELECT 1 FROM ticket_replies r
        WHERE r.ticket_id = rt.id
          AND r.agent_id = rt.agent_id
          AND r.is_ai = false
          AND r.is_public = true
      )
      GROUP BY rt.agent_id
    ),

    /* Open snapshot — current state, identical across recomputed dates. */
    open_now AS (
      SELECT t.responder_id AS agent_id, COUNT(*)::int AS n
      FROM tickets t
      WHERE t.responder_id IS NOT NULL
        AND t.spam = false AND t.deleted = false
        AND t.status NOT IN (4, 5)  -- 4=Resolved, 5=Closed
      GROUP BY t.responder_id
    )

    SELECT
      e.id                            AS agent_id,
      COALESCE(asg.n, 0)              AS assigned,
      COALESCE(rep.n, 0)              AS replied,
      COALESCE(res.n, 0)              AS resolved,
      COALESCE(hnd.n, 0)              AS handled,
      COALESCE(res.n, 0) - COALESCE(hnd.n, 0) AS passthrough,
      COALESCE(opn.n, 0)              AS open
    FROM execs e
    LEFT JOIN assigned    asg ON asg.agent_id = e.id
    LEFT JOIN replied     rep ON rep.agent_id = e.id
    LEFT JOIN resolved    res ON res.agent_id = e.id
    LEFT JOIN handled     hnd ON hnd.agent_id = e.id
    LEFT JOIN open_now    opn ON opn.agent_id = e.id
  `);

  // `db.execute` returns whatever the driver returns; for neon-http it's the
  // array of row objects directly when using sql template. Normalise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = ((rows as any).rows ?? rows) as Array<{
    agent_id: number;
    assigned: number;
    replied: number;
    resolved: number;
    handled: number;
    passthrough: number;
    open: number;
  }>;

  return list.map((r) => ({
    agentId: Number(r.agent_id),
    assigned: Number(r.assigned),
    replied: Number(r.replied),
    resolved: Number(r.resolved),
    handled: Number(r.handled),
    passthrough: Number(r.passthrough),
    open: Number(r.open),
  }));
}

/**
 * Normalises replied + handled across the day's executives and combines via
 * the configured weights. All-zero days yield score 0 for everyone.
 */
function scoreAgents(
  counts: AgentDayCounts[]
): Array<AgentDayCounts & { score: number }> {
  const maxReplied = Math.max(0, ...counts.map((c) => c.replied));
  const maxHandled = Math.max(0, ...counts.map((c) => c.handled));

  return counts.map((c) => {
    const repliedN = maxReplied > 0 ? c.replied / maxReplied : 0;
    const handledN = maxHandled > 0 ? c.handled / maxHandled : 0;
    const score =
      SCORE_WEIGHTS.replied * repliedN + SCORE_WEIGHTS.handled * handledN;
    return { ...c, score };
  });
}

/**
 * For every resolved ticket with IST(resolved_at) in the affected dates,
 * stamp tickets.resolution_class as 'handled' or 'passthrough' based on
 * whether the responder posted a human reply on that ticket.
 */
async function stampResolutionClass(istDates: string[]): Promise<void> {
  const tz = TIMEZONE;
  await db.execute(sql`
    UPDATE tickets t
    SET resolution_class = CASE
      WHEN EXISTS (
        SELECT 1 FROM ticket_replies r
        WHERE r.ticket_id = t.id
          AND r.agent_id = t.responder_id
          AND r.is_ai = false
          AND r.is_public = true
      ) THEN 'handled'
      ELSE 'passthrough'
    END
    WHERE t.resolved_at IS NOT NULL
      AND t.responder_id IS NOT NULL
      AND ((t.resolved_at AT TIME ZONE ${tz})::date) = ANY(${istDates}::date[])
  `);
}
