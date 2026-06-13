import Link from "next/link";
import {
  getEscalationOverview,
  getEscalationWatchlist,
  listEscalationAgents,
  listEscalations,
  type EscalationRow,
  type ListEscalationsFilters,
} from "@/lib/queries";
import { StatCard } from "@/components/StatCard";
import { EscalationFilters } from "@/components/EscalationFilters";
import { NewEscalationForm } from "@/components/NewEscalationForm";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    channel?: string;
    status?: string;
    agent?: string;
    isPublic?: string;
    needsAttention?: string;
  }>;
}

export default async function EscalationsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filters: ListEscalationsFilters = {
    channel: sp.channel || undefined,
    status: sp.status || undefined,
    agent: sp.agent || undefined,
    isPublic:
      sp.isPublic === "true"
        ? true
        : sp.isPublic === "false"
        ? false
        : undefined,
    needsAttention:
      sp.needsAttention === "true"
        ? true
        : sp.needsAttention === "false"
        ? false
        : undefined,
  };

  const [overview, watchlist, rows, agents] = await Promise.all([
    getEscalationOverview(),
    getEscalationWatchlist(50),
    listEscalations(filters),
    listEscalationAgents(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Escalations</h1>
          <p className="text-sm text-[var(--muted)]">
            Work outside Freshdesk · visibility-only, not part of the Freshdesk
            score
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={overview.total} />
        <StatCard
          label="Needs attention"
          value={overview.needsAttention}
          tone={overview.needsAttention > 0 ? "warn" : "default"}
        />
        <StatCard
          label="Public · open"
          value={overview.publicOpen}
          tone={overview.publicOpen > 0 ? "warn" : "default"}
          sub="reputation surface"
        />
        <StatCard
          label="Legal threats"
          value={overview.legalThreats}
          tone={overview.legalThreats > 0 ? "bad" : "default"}
        />
      </div>

      {/* Reputation watchlist */}
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Reputation watchlist · public + open
        </h2>
        {watchlist.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
            Nothing to watch. No public escalation is currently open.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--background)] text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Opened</th>
                  <th className="px-3 py-2 text-left">Channel</th>
                  <th className="px-3 py-2 text-left">Author</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Agent</th>
                  <th className="px-3 py-2 text-left">Issue</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((r) => (
                  <WatchlistRow key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewEscalationForm agents={agents} />

      {/* Filter bar + all-escalations table */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            All escalations · {rows.length} shown
          </h2>
          <EscalationFilters agents={agents} />
        </div>

        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--background)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Opened</th>
                <th className="px-3 py-2 text-left">Channel</th>
                <th className="px-3 py-2 text-left">Author</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Agent</th>
                <th className="px-3 py-2 text-left">Credit</th>
                <th className="px-3 py-2 text-left">Ticket</th>
                <th className="px-3 py-2 text-left">Remediation</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-6 text-center text-[var(--muted)]"
                  >
                    No escalations match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => <FullRow key={r.id} row={r} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function WatchlistRow({ row }: { row: EscalationRow }) {
  const cls = row.legalThreat
    ? "border-t border-[var(--bad)]/40 bg-red-50 hover:bg-red-100/60"
    : "border-t border-[var(--border)] hover:bg-[var(--background)]";
  return (
    <tr className={cls}>
      <td className="px-3 py-2 font-mono text-xs">
        <Link
          href={`/escalations/${row.id}`}
          className="hover:underline"
        >
          {row.openedAt ?? `#${row.id}`}
        </Link>
      </td>
      <td className="px-3 py-2">
        {row.channel}
        <span className="ml-1 text-[var(--subtle)]">
          {row.medium ? `· ${row.medium}` : ""}
        </span>
        {row.legalThreat ? (
          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--bad)]">
            Legal
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{row.authorName ?? "—"}</div>
        <div className="text-xs text-[var(--muted)]">
          {row.authorEmail ?? row.handle ?? ""}
        </div>
      </td>
      <td className="px-3 py-2 capitalize">{row.status.replace(/_/g, " ")}</td>
      <td className="px-3 py-2">{row.agent ?? "—"}</td>
      <td className="px-3 py-2 max-w-md truncate text-[var(--muted)]">
        {row.issueText ?? "—"}
      </td>
    </tr>
  );
}

function FullRow({ row }: { row: EscalationRow }) {
  const cls = row.legalThreat
    ? "border-t border-[var(--bad)]/30 bg-red-50/40 hover:bg-red-100/60"
    : row.needsAttention
    ? "border-t border-[var(--border)] bg-amber-50/40 hover:bg-amber-100/60"
    : "border-t border-[var(--border)] hover:bg-[var(--background)]";
  return (
    <tr className={cls}>
      <td className="px-3 py-2 font-mono text-xs">
        <Link
          href={`/escalations/${row.id}`}
          className="text-[var(--accent)] hover:underline"
        >
          {row.openedAt ?? `#${row.id}`}
        </Link>
      </td>
      <td className="px-3 py-2 text-xs">
        {row.channel}
        {row.medium ? <span className="text-[var(--subtle)]"> · {row.medium}</span> : null}
        {row.isPublic ? null : (
          <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] uppercase text-[var(--muted)]">
            private
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        <div>{row.authorName ?? row.authorEmail ?? row.handle ?? "—"}</div>
        {row.authorEmail && row.authorName ? (
          <div className="text-[var(--subtle)]">{row.authorEmail}</div>
        ) : null}
      </td>
      <td className="px-3 py-2 text-xs text-[var(--muted)]">
        {row.category ? row.category.replace(/_/g, " ") : "—"}
      </td>
      <td className="px-3 py-2 text-xs capitalize">
        {row.status.replace(/_/g, " ")}
        {row.legalThreat ? (
          <span className="ml-1 rounded bg-red-100 px-1 text-[10px] font-medium uppercase text-[var(--bad)]">
            legal
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-xs">{row.agent ?? "—"}</td>
      <td
        className={`px-3 py-2 text-xs ${
          row.creditClass === "merit"
            ? "text-[var(--good)]"
            : "text-[var(--subtle)]"
        }`}
      >
        {row.creditClass}
        {row.escalationType === "pileon_comment" ? (
          <span className="ml-1 text-[10px] text-[var(--subtle)]">pile-on</span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-xs">
        {row.freshdeskTicket ? (
          <span className="font-mono">{row.freshdeskTicket}</span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2 text-xs text-[var(--muted)]">
        {row.remediation ?? "—"}
      </td>
    </tr>
  );
}
