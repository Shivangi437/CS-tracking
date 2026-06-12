import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getEscalationById,
  listEscalationAgents,
  type EscalationRow,
} from "@/lib/queries";
import { EscalationEditClient } from "@/components/EscalationEditClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EscalationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const num = Number(id);
  if (!Number.isFinite(num)) return notFound();

  const e = await getEscalationById(num);
  if (!e) return notFound();

  // For commit 1 the dropdown's source is the existing distinct-agents
  // helper. Commit 3 swaps this to team_members + adds the edit UI.
  const teamMemberNames = await listEscalationAgents();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/escalations"
          className="text-xs text-[var(--muted)] hover:underline"
        >
          ← back to escalations
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Escalation #{e.id}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Visibility-only — not part of the Freshdesk score
        </p>
      </div>

      {/* Read-only context block */}
      <ContextBlock e={e} />

      {/* Derived flags display */}
      <FlagsBlock e={e} />

      {/* Editable section */}
      <EscalationEditClient escalation={e} teamMemberNames={teamMemberNames} />

      {/* Audit trail placeholder — populated in commit 4 */}
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
        Edit history will appear here once the audit log lands (commit 4).
      </div>
    </div>
  );
}

function ContextBlock({ e }: { e: EscalationRow }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Context
        </h2>
        <div className="flex items-center gap-2">
          {e.legalThreat ? (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--bad)]">
              Legal threat
            </span>
          ) : null}
          {e.needsAttention ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700">
              Needs attention
            </span>
          ) : null}
          {e.closureConfirmed ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700">
              Closure confirmed
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        <KV label="Opened" value={e.openedAt ?? "—"} mono />
        <KV
          label="Channel"
          value={
            <>
              {e.channel}
              {e.medium ? (
                <span className="text-[var(--subtle)]"> · {e.medium}</span>
              ) : null}
              {e.isPublic ? (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700">
                  public
                </span>
              ) : (
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--muted)]">
                  private
                </span>
              )}
            </>
          }
        />
        <KV label="Author" value={e.authorName ?? "—"} />
        <KV
          label="Author email"
          value={e.authorEmail ?? e.handle ?? "—"}
          mono
        />
        {e.authorEmailAlt ? (
          <KV label="Author email (alt)" value={e.authorEmailAlt} mono />
        ) : null}
        {e.handle && e.authorEmail ? (
          <KV label="Handle" value={e.handle} mono />
        ) : null}
        <KV
          label="Resolved at"
          value={e.resolvedAt ? formatStamp(e.resolvedAt) : "—"}
          mono
        />
      </div>

      {e.issueText ? (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Issue
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{e.issueText}</p>
        </div>
      ) : null}
    </div>
  );
}

function FlagsBlock({ e }: { e: EscalationRow }) {
  const merit = e.creditClass === "merit";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Server-derived flags
        </h2>
        <span className="text-[11px] text-[var(--subtle)]">
          Re-computed on every save from status + medium + channel
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Credit class"
          value={e.creditClass}
          tone={merit ? "good" : "subtle"}
        />
        <Tile
          label="Escalation type"
          value={e.escalationType.replace(/_/g, " ")}
        />
        <Tile
          label="Is public"
          value={e.isPublic ? "yes" : "no"}
          tone={e.isPublic ? "warn" : "default"}
        />
        <Tile
          label="Needs attention"
          value={e.needsAttention ? "yes" : "no"}
          tone={e.needsAttention ? "warn" : "default"}
        />
      </div>
    </div>
  );
}

function KV({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className={`mt-0.5 text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "good" | "warn" | "subtle";
}) {
  const cls =
    tone === "good"
      ? "text-[var(--good)]"
      : tone === "warn"
      ? "text-[var(--warn)]"
      : tone === "subtle"
      ? "text-[var(--subtle)]"
      : "text-[var(--foreground)]";
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-medium capitalize ${cls}`}>
        {value}
      </div>
    </div>
  );
}

function formatStamp(d: Date): string {
  return new Date(d).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
