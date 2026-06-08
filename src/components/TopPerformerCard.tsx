import type { LeaderboardRow } from "@/lib/queries";

interface Props {
  row: LeaderboardRow | null;
  periodLabel: string;
}

export function TopPerformerCard({ row, periodLabel }: Props) {
  if (!row) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
        No top performer yet — {periodLabel.toLowerCase()} has no human-handled
        activity.
      </div>
    );
  }
  const name = row.name.split("||")[0].trim() || row.name;
  return (
    <div className="rounded-lg border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-amber-700">
            Top performer · {periodLabel}
          </div>
          <div className="mt-1 text-xl font-semibold tracking-tight">
            {name}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums text-amber-700">
            {(row.score * 100).toFixed(0)}
          </div>
          <div className="text-[10px] uppercase text-[var(--muted)]">score</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <Stat label="Replied" value={row.replied} />
        <Stat label="Handled" value={row.handled} tone="good" />
        <Stat label="Passthrough" value={row.passthrough} tone="subtle" />
      </div>
      <div className="mt-3 text-[11px] text-[var(--muted)]">
        Score = 0.5 × norm(replied) + 0.5 × norm(handled). Passthrough closes
        excluded.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "good" | "subtle";
}) {
  const cls =
    tone === "good"
      ? "text-[var(--good)]"
      : tone === "subtle"
      ? "text-[var(--subtle)]"
      : "text-[var(--foreground)]";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
