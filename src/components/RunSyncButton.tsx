"use client";

import { useState, useTransition } from "react";
import { triggerSyncAction } from "@/lib/actions";

export function RunSyncButton({
  variant = "default",
}: {
  variant?: "default" | "subtle";
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const base =
    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";
  const styles =
    variant === "subtle"
      ? `${base} border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--background)]`
      : `${base} bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90`;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className={styles}
        disabled={pending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const r = await triggerSyncAction();
            setResult(r);
          });
        }}
      >
        {pending ? "Syncing…" : "Run sync"}
      </button>
      {result ? (
        <span
          className={`text-xs ${
            result.ok ? "text-[var(--good)]" : "text-[var(--bad)]"
          }`}
        >
          {result.message}
        </span>
      ) : null}
    </div>
  );
}
