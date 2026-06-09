import { getPeriodReport, hasAnySync } from "@/lib/queries";
import {
  istToday,
  istMonthToDateRange,
  istShiftDays,
} from "@/lib/dates";
import { StatCard } from "@/components/StatCard";
import { Leaderboard } from "@/components/Leaderboard";
import { TopPerformerCard } from "@/components/TopPerformerCard";
import { RunSyncButton } from "@/components/RunSyncButton";
import { SyncBadge } from "@/components/SyncBadge";
import { WeekChart } from "@/components/WeekChart";

export const dynamic = "force-dynamic";

export default async function MonthPage() {
  const ever = await hasAnySync();
  if (!ever) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-10 text-center">
        <h1 className="text-lg font-semibold">No data yet</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Run the first sync to backfill the last 30 days.
        </p>
        <div className="mt-4 flex justify-center">
          <RunSyncButton />
        </div>
      </div>
    );
  }

  const today = istToday();
  const { start, end } = istMonthToDateRange(today);
  const span = daysBetween(start, end);

  const [current, previous] = await Promise.all([
    getPeriodReport(start, end),
    getPriorSameLength(start, end, span),
  ]);

  const chartData = current.rows.map((r) => ({
    name: r.name.split("||")[0].trim() || r.name,
    handled: r.handled,
    passthrough: r.passthrough,
  }));

  const totalsDelta = {
    assigned: current.totals.assigned - previous.totals.assigned,
    replied: current.totals.replied - previous.totals.replied,
    resolved: current.totals.resolved - previous.totals.resolved,
    handled: current.totals.handled - previous.totals.handled,
    passthrough: current.totals.passthrough - previous.totals.passthrough,
  };

  const monthLabel = formatMonthLabel(start);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {monthLabel} (month-to-date)
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {start} → {end} (IST) · {span + 1} days
          </p>
        </div>
        <div className="flex items-center gap-4">
          <SyncBadge at={current.lastSyncedAt} />
          <RunSyncButton variant="subtle" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Assigned"
          value={current.totals.assigned}
          sub={fmtDelta(totalsDelta.assigned)}
        />
        <StatCard
          label="Replied"
          value={current.totals.replied}
          sub={fmtDelta(totalsDelta.replied)}
        />
        <StatCard
          label="Resolved"
          value={current.totals.resolved}
          sub={`${current.totals.handled} h / ${current.totals.passthrough} p · ${fmtDelta(totalsDelta.resolved)}`}
        />
        <StatCard
          label="Handled"
          value={current.totals.handled}
          tone="good"
          sub={fmtDelta(totalsDelta.handled)}
        />
        <StatCard
          label="Passthrough"
          value={current.totals.passthrough}
          sub={`AI-closed · ${fmtDelta(totalsDelta.passthrough)}`}
        />
      </div>

      <TopPerformerCard
        row={current.topPerformer}
        periodLabel={monthLabel}
      />

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Resolved split per executive
        </h2>
        <WeekChart data={chartData} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Monthly leaderboard
        </h2>
        <Leaderboard
          rows={current.rows}
          highlightAgentId={current.topPerformer?.agentId ?? null}
        />
      </div>
    </div>
  );
}

function getPriorSameLength(start: string, _end: string, span: number) {
  const priorEnd = istShiftDays(start, -1);
  const priorStart = istShiftDays(priorEnd, -span);
  return getPeriodReport(priorStart, priorEnd);
}

function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00+05:30`).getTime();
  const b = new Date(`${end}T00:00:00+05:30`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function fmtDelta(n: number): string {
  if (n === 0) return "no change vs prior";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n} vs prior period`;
}

function formatMonthLabel(startOfMonth: string): string {
  const d = new Date(`${startOfMonth}T00:00:00+05:30`);
  return d.toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}
