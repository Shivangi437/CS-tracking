import { notFound } from "next/navigation";
import { sql, and, eq, isNotNull, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";
import {
  getAgentById,
  getAgentDailySeries,
  getPeriodReport,
} from "@/lib/queries";
import { istToday, istShiftDays } from "@/lib/dates";
import { StatCard } from "@/components/StatCard";
import { AgentSeriesChart } from "@/components/AgentSeriesChart";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const agentId = Number(id);
  if (!Number.isFinite(agentId)) return notFound();

  const agent = await getAgentById(agentId);
  if (!agent) return notFound();

  const today = istToday();
  const start = istShiftDays(today, -29); // last 30 days inclusive
  const end = today;

  const [series, periodReport, reopens] = await Promise.all([
    getAgentDailySeries(agentId, start, end),
    getPeriodReport(start, end),
    countReopens(agentId, start, end),
  ]);

  const me = periodReport.rows.find((r) => r.agentId === agentId);
  const name = agent.name.split("||")[0].trim() || agent.name;

  const handledRatio =
    me && me.resolved > 0 ? Math.round((me.handled / me.resolved) * 100) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
        <p className="text-sm text-[var(--muted)]">
          {agent.email ?? "—"} · last 30 days ({start} → {end})
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Assigned" value={me?.assigned ?? 0} />
        <StatCard label="Replied" value={me?.replied ?? 0} />
        <StatCard
          label="Resolved"
          value={me?.resolved ?? 0}
          sub={
            handledRatio == null
              ? "—"
              : `${handledRatio}% handled by you`
          }
        />
        <StatCard label="Handled" value={me?.handled ?? 0} tone="good" />
        <StatCard
          label="Reopens"
          value={reopens}
          tone={reopens > 5 ? "warn" : "default"}
          sub="tickets re-opened after first resolve"
        />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Daily activity
        </h2>
        <AgentSeriesChart data={series} />
      </div>
    </div>
  );
}

/**
 * Tickets currently or formerly assigned to this exec that have a reopened_at
 * in the period.
 */
async function countReopens(
  agentId: number,
  start: string,
  end: string
): Promise<number> {
  const r = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(tickets)
    .where(
      and(
        eq(tickets.responderId, agentId),
        isNotNull(tickets.reopenedAt),
        gte(
          sql`((${tickets.reopenedAt} AT TIME ZONE 'Asia/Kolkata')::date)`,
          start
        ),
        lte(
          sql`((${tickets.reopenedAt} AT TIME ZONE 'Asia/Kolkata')::date)`,
          end
        )
      )
    );
  return r[0]?.n ?? 0;
}
