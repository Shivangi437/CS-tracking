"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CHANNELS,
  MEDIA,
  STATUSES,
  CATEGORIES,
} from "@/lib/escalations";
import {
  createEscalationAction,
  type CreateEscalationInput,
} from "@/lib/escalation-actions";

/**
 * Manual entry for escalations that arrive outside Freshdesk.
 *
 * UI rule (this codebase): no `<form>` element — every field is a
 * controlled input with onChange, the Save button has an onClick handler
 * that calls the server action with the assembled payload. Server derives
 * credit_class / is_public / needs_attention from the inputs; client never
 * sets them.
 */

interface Props {
  agents: string[]; // suggestion list for the agent field
}

const EMPTY: CreateEscalationInput = {
  channel: "",
  medium: "",
  status: "unlogged",
  category: "",
  authorEmail: "",
  handle: "",
  authorName: "",
  issueText: "",
  agent: "",
  freshdeskTicket: "",
  remediation: "",
  notes: "",
  legalThreat: false,
  openedAt: "",
};

export function NewEscalationForm({ agents }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CreateEscalationInput>(EMPTY);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const router = useRouter();

  const update = <K extends keyof CreateEscalationInput>(
    key: K,
    value: CreateEscalationInput[K]
  ) => {
    setState((s) => ({ ...s, [key]: value }));
  };

  const handleSave = () => {
    setResult(null);
    startTransition(async () => {
      const r = await createEscalationAction(state);
      setResult(r);
      if (r.ok) {
        setState(EMPTY);
        router.refresh();
        setTimeout(() => setOpen(false), 1200);
      }
    });
  };

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90"
        >
          + Log escalation
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          New escalation
        </h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Channel *">
          <Select
            value={state.channel}
            onChange={(v) => update("channel", v)}
            options={["", ...CHANNELS]}
          />
        </Field>

        <Field label="Medium *">
          <Select
            value={state.medium}
            onChange={(v) => update("medium", v)}
            options={["", ...MEDIA]}
          />
        </Field>

        <Field label="Status">
          <Select
            value={state.status}
            onChange={(v) => update("status", v)}
            options={STATUSES}
          />
        </Field>

        <Field label="Category">
          <Select
            value={state.category ?? ""}
            onChange={(v) => update("category", v)}
            options={["", ...CATEGORIES]}
          />
        </Field>

        <Field label="Credited executive *">
          <input
            list="agent-suggestions"
            type="text"
            value={state.agent}
            onChange={(e) => update("agent", e.target.value)}
            className={inputCls}
            placeholder="e.g. Manpreet Mehra"
          />
          <datalist id="agent-suggestions">
            {agents.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>

        <Field label="Opened on (IST)">
          <input
            type="date"
            value={state.openedAt ?? ""}
            onChange={(e) => update("openedAt", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Author email">
          <input
            type="email"
            value={state.authorEmail ?? ""}
            onChange={(e) => update("authorEmail", e.target.value)}
            className={inputCls}
            placeholder="author@domain.tld"
          />
        </Field>

        <Field label="Author handle (if no email)">
          <input
            type="text"
            value={state.handle ?? ""}
            onChange={(e) => update("handle", e.target.value)}
            className={inputCls}
            placeholder="@handle"
          />
        </Field>

        <Field label="Author name">
          <input
            type="text"
            value={state.authorName ?? ""}
            onChange={(e) => update("authorName", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Freshdesk ticket (if any)">
          <input
            type="text"
            value={state.freshdeskTicket ?? ""}
            onChange={(e) => update("freshdeskTicket", e.target.value)}
            className={inputCls}
            placeholder="ticket id or link"
          />
        </Field>

        <Field label="Remediation">
          <input
            type="text"
            value={state.remediation ?? ""}
            onChange={(e) => update("remediation", e.target.value)}
            className={inputCls}
            placeholder="PR Article / Author Copies / Award / ..."
          />
        </Field>

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!state.legalThreat}
              onChange={(e) => update("legalThreat", e.target.checked)}
              className="h-4 w-4"
            />
            Legal threat
          </label>
        </div>

        <div className="md:col-span-2">
          <Field label="Issue *">
            <textarea
              value={state.issueText}
              onChange={(e) => update("issueText", e.target.value)}
              className={`${inputCls} min-h-[64px]`}
              placeholder="What the author said + reference link"
            />
          </Field>
        </div>

        <div className="md:col-span-2">
          <Field label="Notes">
            <textarea
              value={state.notes ?? ""}
              onChange={(e) => update("notes", e.target.value)}
              className={`${inputCls} min-h-[48px]`}
              placeholder="Anything else — internal context, links"
            />
          </Field>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[11px] text-[var(--subtle)]">
          Credit class &amp; visibility flags are derived server-side from
          status + medium + channel. You can&apos;t set them.
        </span>
        <div className="flex items-center gap-3">
          {result ? (
            <span
              className={`text-xs ${
                result.ok ? "text-[var(--good)]" : "text-[var(--bad)]"
              }`}
            >
              {result.message}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save escalation"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o || "—"}
        </option>
      ))}
    </select>
  );
}
