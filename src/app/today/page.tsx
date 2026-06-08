import { getPeriodReport, hasAnySync } from "@/lib/queries";
import { istToday } from "@/lib/dates";
import { StatCard } from "@/components/StatCard";
import { Leaderboard } from "@/components/Leaderboard";
import { TopPerformerCard } from "@/components/TopPerformerCard";
import { RunSyncButton } from "@/components/RunSyncButton";
import { SyncBadge } from "@/components/SyncBadge";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const ever = await hasAnySync();
  if (!ever) {
    return <EmptyState />;
  }

  const today = istToday();
  const r = await getPeriodReport(today, today);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Today</h1>
          <p className="text-sm text-[var(--muted)]">{today} (IST)</p>
        </div>
        <div className="flex items-center gap-4">
          <SyncBadge at={r.lastSyncedAt} />
          <RunSyncButton variant="subtle" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Assigned" value={r.totals.assigned} />
        <StatCard label="Replied" value={r.totals.replied} />
        <StatCard
          label="Resolved"
          value={r.totals.resolved}
          sub={`${r.totals.handled} handled / ${r.totals.passthrough} passthrough`}
        />
        <StatCard label="Handled" value={r.totals.handled} tone="good" />
        <StatCard
          label="Passthrough"
          value={r.totals.passthrough}
          sub="AI-closed"
        />
        <StatCard
          label="Open"
          value={r.totals.open}
          tone={r.totals.open > 50 ? "warn" : "default"}
        />
      </div>

      <TopPerformerCard row={r.topPerformer} periodLabel="Today" />

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Leaderboard
        </h2>
        <Leaderboard
          rows={r.rows}
          highlightAgentId={r.topPerformer?.agentId ?? null}
        />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-10 text-center">
      <h1 className="text-lg font-semibold">No data yet</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Run the first sync to backfill the last 30 days from Freshdesk.
      </p>
      <div className="mt-4 flex justify-center">
        <RunSyncButton />
      </div>
    </div>
  );
}
