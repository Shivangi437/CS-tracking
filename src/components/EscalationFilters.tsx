"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CHANNELS, STATUSES } from "@/lib/escalations";

/**
 * Filters for /escalations. URL-driven via searchParams so the resulting
 * filtered view is shareable. No `<form>` tag: each select uses onChange
 * to push the new URL.
 */
export function EscalationFilters({ agents }: { agents: string[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    startTransition(() => {
      router.push(`/escalations?${next.toString()}`);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        label="Channel"
        value={sp.get("channel") ?? ""}
        onChange={(v) => setParam("channel", v)}
        options={["", ...CHANNELS]}
      />
      <Select
        label="Status"
        value={sp.get("status") ?? ""}
        onChange={(v) => setParam("status", v)}
        options={["", ...STATUSES]}
      />
      <Select
        label="Agent"
        value={sp.get("agent") ?? ""}
        onChange={(v) => setParam("agent", v)}
        options={["", ...agents]}
      />
      <Select
        label="Visibility"
        value={sp.get("isPublic") ?? ""}
        onChange={(v) => setParam("isPublic", v)}
        options={["", "true", "false"]}
        renderOption={(v) =>
          v === "true" ? "Public" : v === "false" ? "Private" : "All"
        }
      />
      <Select
        label="Needs attention"
        value={sp.get("needsAttention") ?? ""}
        onChange={(v) => setParam("needsAttention", v)}
        options={["", "true", "false"]}
        renderOption={(v) =>
          v === "true" ? "Flagged" : v === "false" ? "Clear" : "All"
        }
      />
      {Array.from(sp.keys()).length > 0 ? (
        <button
          type="button"
          onClick={() => startTransition(() => router.push("/escalations"))}
          className="rounded-md border border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--background)]"
        >
          Clear
        </button>
      ) : null}
      {pending ? (
        <span className="text-xs text-[var(--subtle)]">filtering…</span>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  renderOption,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  renderOption?: (v: string) => string;
}) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {renderOption ? renderOption(o) : o || "All"}
          </option>
        ))}
      </select>
    </label>
  );
}
