import type { EscalationEditEntry } from "@/lib/queries";

/**
 * Edit history block for the escalation detail page. Reverse-
 * chronological list of every recorded change. Plain text values —
 * nothing here is editable.
 */
export function EscalationEditHistory({
  entries,
}: {
  entries: EscalationEditEntry[];
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Edit history
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--subtle)]">
          One row per field changed. Credit disputes look here, not Slack.
        </p>
      </div>
      {entries.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">
          No edits recorded yet.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-[var(--background)] text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Who</th>
              <th className="px-3 py-2 text-left">Field</th>
              <th className="px-3 py-2 text-left">Was</th>
              <th className="px-3 py-2 text-left">Now</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 text-xs text-[var(--muted)] whitespace-nowrap">
                  {formatStamp(e.editedAt)}
                </td>
                <td className="px-3 py-2 font-medium">{e.editedBy}</td>
                <td className="px-3 py-2 text-xs">
                  {prettyField(e.fieldName)}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--subtle)]">
                  {formatValue(e.oldValue)}
                </td>
                <td className="px-3 py-2 text-xs">
                  {formatValue(e.newValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  category: "Category",
  agent: "Credited agent",
  remediation: "Remediation",
  notes: "Notes",
  freshdeskTicket: "Freshdesk ticket ref",
  verifiedBy: "Verified by",
  acknowledgedAt: "Acknowledged at",
  legalThreat: "Legal threat",
  closureConfirmed: "Closure confirmed",
  creditClass: "Credit class",
  escalationType: "Escalation type",
  isPublic: "Public",
  needsAttention: "Needs attention",
};

function prettyField(name: string): string {
  return FIELD_LABELS[name] ?? name;
}

function formatValue(v: string | null): React.ReactNode {
  if (v == null || v === "") return <span className="italic text-[var(--subtle)]">empty</span>;
  // ISO timestamps → friendlier display.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
    try {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        return formatStamp(d);
      }
    } catch {
      /* fall through */
    }
  }
  return v;
}

function formatStamp(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
