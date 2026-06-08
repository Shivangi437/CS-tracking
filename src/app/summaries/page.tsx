import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { summaries } from "@/lib/db/schema";
import { formatIstStamp } from "@/lib/dates";

export const dynamic = "force-dynamic";

interface SummaryPayload {
  totals?: {
    assigned: number;
    replied: number;
    resolved: number;
    handled: number;
    passthrough: number;
  };
  topPerformer?: { name: string; score: number };
}

export default async function SummariesPage() {
  const rows = await db
    .select()
    .from(summaries)
    .orderBy(desc(summaries.periodEnd), desc(summaries.id))
    .limit(50);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Summaries archive</h1>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-8 text-center text-sm text-[var(--muted)]">
          No summaries yet. They'll appear here after the first daily (18:00 IST)
          or weekly (Friday 18:00 IST) cron run.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--background)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Period</th>
                <th className="px-3 py-2 text-right">Assigned</th>
                <th className="px-3 py-2 text-right">Replied</th>
                <th className="px-3 py-2 text-right">Resolved</th>
                <th className="px-3 py-2 text-right">Handled</th>
                <th className="px-3 py-2 text-left">Top performer</th>
                <th className="px-3 py-2 text-left">Generated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const p = row.payload as SummaryPayload;
                const t = p.totals;
                return (
                  <tr
                    key={row.id}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-2 capitalize">{row.type}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.periodStart}
                      {row.periodEnd !== row.periodStart
                        ? ` → ${row.periodEnd}`
                        : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t?.assigned ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t?.replied ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t?.resolved ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--good)]">
                      {t?.handled ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--muted)]">
                      {p.topPerformer?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--subtle)]">
                      {formatIstStamp(row.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
