interface StatCardProps {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
}

const TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-[var(--foreground)]",
  good: "text-[var(--good)]",
  warn: "text-[var(--warn)]",
  bad: "text-[var(--bad)]",
};

export function StatCard({ label, value, sub, tone = "default" }: StatCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-[var(--muted)]">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${TONE[tone]}`}>
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-xs text-[var(--subtle)]">{sub}</div>
      ) : null}
    </div>
  );
}
