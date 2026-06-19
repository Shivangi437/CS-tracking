import Link from "next/link";
import {
  getPeriodReport,
  getBacklogByPortal,
  hasAnySync,
} from "@/lib/queries";
import { istToday, istShiftDays } from "@/lib/dates";
import { StatCard } from "@/components/StatCard";
import { Leaderboard } from "@/components/Leaderboard";
import { TopPerformerCard } from "@/components/TopPerformerCard";
import { RunSyncButton } from "@/components/RunSyncButton";
import { SyncBadge } from "@/components/SyncBadge";
import { DatePicker } from "@/components/DatePicker";
import { BACKFILL_DAYS, PORTAL_KEYS, PORTAL_TARGETS } from "@/lib/config";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ date?: string }>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function TodayPage({ searchParams }: PageProps) {
  const ever = await hasAnySync();
  if (!ever) {
    return <EmptyState />;
  }

  const today = istToday();
  const sp = await searchParams;

  // Clamp inputs: reject malformed strings, never let a future date through.
  let date = today;
  if (sp.date && ISO_DATE.test(sp.date) && sp.date <= today) {
    date = sp.date;
  }
  const isToday = date === today;

  // History floor: how far back the picker lets you go. We keep enough
  // history that the dashboard is useful for retros, but not infinite.
  const minDate = istShiftDays(today, -BACKFILL_DAYS - 60);

  const r = await getPeriodReport(date, date);

  // Live backlog snapshot is only meaningful for "today" (it's current state,
  // not a historical figure), so we only fetch + show it on the today view.
  const backlog = isToday ? await getBacklogByPortal() : null;

  const { title, subtitle, periodLabel } = labelsFor(date, today);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-[var(--muted)]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <DatePicker value={date} max={today} min={minDate} />
          {isToday ? <SyncBadge at={r.lastSyncedAt} /> : null}
          {isToday ? <RunSyncButton variant="subtle" /> : null}
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
          tone={isToday && r.totals.open > 50 ? "warn" : "default"}
          sub={isToday ? undefined : "current snapshot"}
        />
      </div>

      {backlog ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Backlog by portal
            </h2>
            <Link
              href="/backlog"
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              View details →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {PORTAL_KEYS.map((key) => {
              const t = PORTAL_TARGETS[key];
              const b = backlog[key];
              const owned = b.open + b.pending;
              return (
                <StatCard
                  key={key}
                  label={`${t.label} backlog`}
                  value={owned}
                  sub={`${b.open} open / ${b.pending} pending · cap ${t.backlogCap}`}
                  tone={owned > t.backlogCap ? "bad" : "good"}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      <TopPerformerCard row={r.topPerformer} periodLabel={periodLabel} />

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Leaderboard
        </h2>
        <Leaderboard
          rows={r.rows}
          highlightAgentId={r.topPerformer?.agentId ?? null}
        />
      </div>

      {r.rows.every((row) => row.assigned + row.replied + row.resolved === 0) ? (
        <p className="text-center text-xs text-[var(--subtle)]">
          No activity recorded for {date}. Pick another date or return to today.
        </p>
      ) : null}
    </div>
  );
}

/** "Today" / "Yesterday" / "8 Jun 2026" — gives the title some warmth. */
function labelsFor(
  date: string,
  today: string
): { title: string; subtitle: string; periodLabel: string } {
  if (date === today) {
    return {
      title: "Today",
      subtitle: `${date} (IST)`,
      periodLabel: "Today",
    };
  }
  const yesterday = istShiftDays(today, -1);
  if (date === yesterday) {
    return {
      title: "Yesterday",
      subtitle: `${date} (IST)`,
      periodLabel: "Yesterday",
    };
  }
  const formatted = new Date(`${date}T00:00:00+05:30`).toLocaleString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  return {
    title: formatted,
    subtitle: `${date} (IST)`,
    periodLabel: formatted,
  };
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
