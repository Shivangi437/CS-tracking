import Link from "next/link";
import type { LeaderboardRow } from "@/lib/queries";

interface Props {
  rows: LeaderboardRow[];
  highlightAgentId?: number | null;
}

export function Leaderboard({ rows, highlightAgentId }: Props) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--background)] text-xs uppercase tracking-wide text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-left">Executive</th>
            <th className="px-3 py-2 text-right">Assigned</th>
            <th className="px-3 py-2 text-right">Replied</th>
            <th className="px-3 py-2 text-right">Resolved</th>
            <th className="px-3 py-2 text-right">Handled</th>
            <th className="px-3 py-2 text-right text-[var(--subtle)]">
              Passthrough
            </th>
            <th className="px-3 py-2 text-right">Open</th>
            <th
              className="px-3 py-2 text-right"
              title="0.5 × norm(replied) + 0.5 × norm(handled)"
            >
              Score
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={9}
                className="px-3 py-6 text-center text-[var(--muted)]"
              >
                No executives found.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => {
              const isTop = r.agentId === highlightAgentId;
              return (
                <tr
                  key={r.agentId}
                  className={`border-t border-[var(--border)] ${
                    isTop ? "bg-amber-50" : ""
                  }`}
                >
                  <td className="px-3 py-2 tabular-nums text-[var(--muted)]">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/agents/${r.agentId}`}
                      className="font-medium hover:underline"
                    >
                      {cleanName(r.name)}
                    </Link>
                    {isTop ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-700">
                        Top
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.assigned}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.replied}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.resolved}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-[var(--good)]">
                    {r.handled}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--subtle)]">
                    {r.passthrough}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.open}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {(r.score * 100).toFixed(0)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Strip BookLeaf's "|| BookLeaf || ..." suffixes from Freshdesk display names. */
function cleanName(name: string): string {
  return name.split("||")[0].trim() || name;
}
