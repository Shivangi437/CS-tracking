import { formatIstStamp } from "@/lib/dates";

export function SyncBadge({ at }: { at: Date | null }) {
  return (
    <span className="text-xs text-[var(--muted)]">
      Last synced: <span className="tabular-nums">{formatIstStamp(at)}</span>
    </span>
  );
}
