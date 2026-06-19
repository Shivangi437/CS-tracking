import {
  getBacklogByPortal,
  getResolvedTodayByPortal,
  getLastSyncedAt,
} from "@/lib/queries";
import { istToday } from "@/lib/dates";
import { PORTAL_KEYS, PORTAL_TARGETS } from "@/lib/config";
import { StatCard } from "@/components/StatCard";
import { SyncBadge } from "@/components/SyncBadge";

export const dynamic = "force-dynamic";

/**
 * Live open-ticket backlog split by Freshdesk Product (usual vs bestseller),
 * with each portal measured against its tunable targets in config.ts.
 * All numbers come from the locally-synced `tickets` table — no Freshdesk
 * API calls on load, so the shared AI-bot rate budget is never touched.
 */
export default async function BacklogPage() {
  const today = istToday();
  const [backlog, resolved, lastSyncedAt] = await Promise.all([
    getBacklogByPortal(),
    getResolvedTodayByPortal(today),
    getLastSyncedAt(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Backlog by portal
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Current open tickets per Freshdesk product · {today} (IST)
          </p>
        </div>
        <SyncBadge at={lastSyncedAt} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PORTAL_KEYS.map((key) => {
          const t = PORTAL_TARGETS[key];
          const b = backlog[key];
          const resolvedToday = resolved[key];
          const ownedBacklog = b.open + b.pending;
          const overCap = ownedBacklog > t.backlogCap;
          const metTarget = resolvedToday >= t.dailyResolveTarget;

          return (
            <section
              key={key}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide">
                  {t.label}
                </h2>
                <span className="text-xs text-[var(--subtle)]">
                  {b.unresolvedTotal} unresolved
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard label="Open" value={b.open} />
                <StatCard label="On hold" value={b.pending} />
                <StatCard label="Other" value={b.onHold} />
                <StatCard
                  label="Backlog"
                  value={ownedBacklog}
                  sub={`Open+On hold · cap ${t.backlogCap}`}
                  tone={overCap ? "bad" : "good"}
                />
                <StatCard
                  label="Resolved today"
                  value={resolvedToday}
                  sub={`target ${t.dailyResolveTarget}`}
                  tone={metTarget ? "good" : "warn"}
                />
                <StatCard
                  label="Status"
                  value={overCap ? "Over cap" : metTarget ? "On track" : "Watch"}
                  tone={overCap ? "bad" : metTarget ? "good" : "warn"}
                />
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-[var(--subtle)]">
        Usual = Freshdesk &quot;None&quot; product · Bestseller = &quot;bestseller&quot;
        product. Backlog counts every ticket not yet Resolved or Closed. Targets
        are tunable in <code>src/lib/config.ts</code>.
      </p>
    </div>
  );
}
