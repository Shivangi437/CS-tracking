"use client";

import { useState } from "react";
import { CATEGORIES, STATUSES } from "@/lib/escalations";
import type { EscalationRow } from "@/lib/queries";

/**
 * Inline edit form for an escalation. UI only in this commit — the Save
 * button is wired up later once updateEscalationAction (commit 2) and
 * the "Editing as" dropdown (commit 4) exist.
 *
 * Codebase convention: NO `<form>` tags. Every input is a controlled
 * onChange, the Save button uses onClick. Server-derived flags
 * (credit_class, escalation_type, is_public, needs_attention) are
 * displayed read-only at the bottom — the client can't set them.
 */

export interface EscalationEditState {
  status: string;
  category: string;
  agent: string;
  remediation: string;
  notes: string;
  freshdeskTicket: string;
  legalThreat: boolean;
  closureConfirmed: boolean;
  acknowledgedAt: string;
  verifiedBy: string;
}

export function escalationToEditState(e: EscalationRow): EscalationEditState {
  return {
    status: e.status,
    category: e.category ?? "",
    agent: e.agent ?? "",
    remediation: e.remediation ?? "",
    notes: e.notes ?? "",
    freshdeskTicket: e.freshdeskTicket ?? "",
    legalThreat: e.legalThreat,
    closureConfirmed: e.closureConfirmed,
    acknowledgedAt: e.acknowledgedAt
      ? toLocalDatetimeInput(new Date(e.acknowledgedAt))
      : "",
    verifiedBy: e.verifiedBy ?? "",
  };
}

interface Props {
  initial: EscalationEditState;
  /** Agent names from the team_members table (commit 3) — manually-curated roster. */
  teamMemberNames: string[];
  /** Pending state — disables save while in flight. */
  pending?: boolean;
  /**
   * Called when the user clicks Save. In commit 1 the parent passes a
   * stub that just shows "(save not wired up yet)". In commit 4 the
   * parent invokes the server action.
   */
  onSave?: (next: EscalationEditState) => void | Promise<void>;
  /** "Editing as" dropdown selection — wired up in commit 4. */
  editingAs?: string;
  onEditingAsChange?: (v: string) => void;
  /** Status message after save (set by parent). */
  result?: { ok: boolean; message: string } | null;
}

export function EscalationEditForm({
  initial,
  teamMemberNames,
  pending = false,
  onSave,
  editingAs,
  onEditingAsChange,
  result,
}: Props) {
  const [state, setState] = useState<EscalationEditState>(initial);

  const update = <K extends keyof EscalationEditState>(
    key: K,
    value: EscalationEditState[K]
  ) => {
    setState((s) => ({ ...s, [key]: value }));
  };

  const dirty = JSON.stringify(state) !== JSON.stringify(initial);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Update
        </h2>
        <span className="text-[11px] text-[var(--subtle)]">
          Credit / visibility flags are derived server-side from these inputs
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Status">
          <Select
            value={state.status}
            onChange={(v) => update("status", v)}
            options={STATUSES}
          />
        </Field>

        <Field label="Category">
          <Select
            value={state.category}
            onChange={(v) => update("category", v)}
            options={["", ...CATEGORIES]}
          />
        </Field>

        <Field label="Credited executive">
          <input
            list="team-member-suggestions"
            type="text"
            value={state.agent}
            onChange={(e) => update("agent", e.target.value)}
            className={inputCls}
            placeholder="Type or pick a name"
          />
          <datalist id="team-member-suggestions">
            {teamMemberNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>

        <Field label="Verified by (manager sign-off)">
          <input
            list="team-member-suggestions"
            type="text"
            value={state.verifiedBy}
            onChange={(e) => update("verifiedBy", e.target.value)}
            className={inputCls}
            placeholder="e.g. Rama"
          />
        </Field>

        <Field label="Acknowledged at">
          <input
            type="datetime-local"
            value={state.acknowledgedAt}
            onChange={(e) => update("acknowledgedAt", e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Freshdesk ticket reference (plain text)">
          <input
            type="text"
            value={state.freshdeskTicket}
            onChange={(e) => update("freshdeskTicket", e.target.value)}
            className={inputCls}
            placeholder="Ticket id or note — not validated against Freshdesk"
          />
        </Field>

        <Field label="Remediation given">
          <input
            type="text"
            value={state.remediation}
            onChange={(e) => update("remediation", e.target.value)}
            className={inputCls}
            placeholder="PR Article / Author Copies / Award / ..."
          />
        </Field>

        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.legalThreat}
              onChange={(e) => update("legalThreat", e.target.checked)}
              className="h-4 w-4"
            />
            Legal threat
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.closureConfirmed}
              onChange={(e) => update("closureConfirmed", e.target.checked)}
              className="h-4 w-4"
            />
            Closure confirmed
          </label>
        </div>

        <div className="md:col-span-2">
          <Field label="Notes">
            <textarea
              value={state.notes}
              onChange={(e) => update("notes", e.target.value)}
              className={`${inputCls} min-h-[64px]`}
              placeholder="Internal context, links, follow-ups"
            />
          </Field>
        </div>
      </div>

      {/* Editing as — required, wired up in commit 4 */}
      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <Field label="Editing as (required for audit log)">
          <Select
            value={editingAs ?? ""}
            onChange={(v) => onEditingAsChange?.(v)}
            options={["", ...teamMemberNames]}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--subtle)]">
          {dirty ? "Unsaved changes" : "No changes"}
        </div>
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
            onClick={() => onSave?.(state)}
            disabled={pending || !dirty || !onSave || !editingAs}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save changes"}
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

/** Format a Date for an <input type="datetime-local"> in IST. */
function toLocalDatetimeInput(d: Date): string {
  // Use the IST offset directly so the datetime-local input shows what the
  // user expects in their local IST timezone without browser drift.
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return ist.toISOString().slice(0, 16);
}
