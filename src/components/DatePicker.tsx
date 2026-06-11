"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition } from "react";

/**
 * URL-driven date picker for the /today page. Changes push to
 * `?date=YYYY-MM-DD` so the URL is shareable. Max is clamped to the IST
 * today; empty value clears the param (returns to today).
 *
 * Uses native <input type="date"> — no new dependency, native mobile UX,
 * keyboard-accessible.
 */
export function DatePicker({
  value,
  max,
  min,
}: {
  value: string;
  max: string;
  min?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const setDate = (next: string) => {
    const url =
      !next || next === max ? pathname : `${pathname}?date=${next}`;
    startTransition(() => router.push(url));
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={value}
        max={max}
        min={min}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
      />
      {value !== max ? (
        <button
          type="button"
          onClick={() => setDate(max)}
          className="rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--background)]"
        >
          Today
        </button>
      ) : null}
      {pending ? (
        <span className="text-xs text-[var(--subtle)]">loading…</span>
      ) : null}
    </div>
  );
}
