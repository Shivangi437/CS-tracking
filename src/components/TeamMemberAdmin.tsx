"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  type TeamMember,
  upsertTeamMemberAction,
  deleteTeamMemberAction,
} from "@/lib/team-members";

/**
 * Client UI for /admin/team — add, edit, deactivate, delete team
 * members. Slack member IDs are entered manually here; the API never
 * queries Slack for them.
 *
 * No <form> tags. onClick / onChange handlers throughout.
 */
export function TeamMemberAdmin({ initial }: { initial: TeamMember[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<{
    name: string;
    slackMemberId: string;
    active: boolean;
  }>({ name: "", slackMemberId: "", active: true });
  const [editing, setEditing] = useState<Record<number, TeamMember>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleAdd = () => {
    setMsg(null);
    startTransition(async () => {
      const r = await upsertTeamMemberAction({
        name: draft.name,
        slackMemberId: draft.slackMemberId,
        active: draft.active,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setDraft({ name: "", slackMemberId: "", active: true });
        router.refresh();
      }
    });
  };

  const handleSave = (m: TeamMember) => {
    const edit = editing[m.id];
    if (!edit) return;
    setMsg(null);
    startTransition(async () => {
      const r = await upsertTeamMemberAction({
        id: m.id,
        name: edit.name,
        slackMemberId: edit.slackMemberId ?? "",
        active: edit.active,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setEditing(({ [m.id]: _, ...rest }) => rest);
        router.refresh();
      }
    });
  };

  const handleDelete = (m: TeamMember) => {
    if (
      !confirm(
        `Remove ${m.name}? Audit log entries with their name will remain.`
      )
    )
      return;
    setMsg(null);
    startTransition(async () => {
      const r = await deleteTeamMemberAction(m.id);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  };

  const startEdit = (m: TeamMember) =>
    setEditing((s) => ({ ...s, [m.id]: { ...m } }));
  const cancelEdit = (id: number) =>
    setEditing(({ [id]: _, ...rest }) => rest);
  const updateEdit = (id: number, patch: Partial<TeamMember>) =>
    setEditing((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  return (
    <div className="space-y-6">
      {/* Add row */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Add team member
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_2fr_1fr_auto]">
          <input
            type="text"
            placeholder="Name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className={inputCls}
          />
          <input
            type="text"
            placeholder="Slack member ID (U07ABC123)"
            value={draft.slackMemberId}
            onChange={(e) =>
              setDraft((d) => ({ ...d, slackMemberId: e.target.value }))
            }
            className={`${inputCls} font-mono`}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) =>
                setDraft((d) => ({ ...d, active: e.target.checked }))
              }
              className="h-4 w-4"
            />
            Active
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={pending || !draft.name.trim()}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Add"}
          </button>
        </div>
        {msg ? (
          <p
            className={`mt-2 text-xs ${
              msg.ok ? "text-[var(--good)]" : "text-[var(--bad)]"
            }`}
          >
            {msg.text}
          </p>
        ) : null}
      </div>

      {/* Existing rows */}
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--background)] text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Slack member ID</th>
              <th className="px-3 py-2 text-left">Active</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-6 text-center text-[var(--muted)]"
                >
                  No team members yet. Add Rama, Vignesh, and the 6 CS execs
                  above.
                </td>
              </tr>
            ) : (
              initial.map((m) => {
                const isEditing = editing[m.id] != null;
                const e = editing[m.id] ?? m;
                return (
                  <tr
                    key={m.id}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          type="text"
                          value={e.name}
                          onChange={(ev) =>
                            updateEdit(m.id, { name: ev.target.value })
                          }
                          className={inputCls}
                        />
                      ) : (
                        <span className={m.active ? "" : "text-[var(--subtle)] line-through"}>
                          {m.name}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {isEditing ? (
                        <input
                          type="text"
                          value={e.slackMemberId ?? ""}
                          onChange={(ev) =>
                            updateEdit(m.id, { slackMemberId: ev.target.value })
                          }
                          className={`${inputCls} font-mono`}
                        />
                      ) : (
                        m.slackMemberId ?? <span className="text-[var(--subtle)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <input
                          type="checkbox"
                          checked={e.active}
                          onChange={(ev) =>
                            updateEdit(m.id, { active: ev.target.checked })
                          }
                          className="h-4 w-4"
                        />
                      ) : m.active ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700">
                          Active
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-[var(--muted)]">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleSave(m)}
                            disabled={pending}
                            className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelEdit(m.id)}
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--background)]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(m)}
                            className="text-xs text-[var(--accent)] hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(m)}
                            className="text-xs text-[var(--bad)] hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]";
