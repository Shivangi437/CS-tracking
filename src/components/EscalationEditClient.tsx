"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  EscalationEditForm,
  type EscalationEditState,
  escalationToEditState,
} from "@/components/EscalationEditForm";
import type { EscalationRow } from "@/lib/queries";
import { updateEscalationAction } from "@/lib/escalation-update";

/**
 * Owns the edit form's "Editing as" identity, the in-flight pending
 * flag, and the save-result toast. The actual server-side write happens
 * in updateEscalationAction; this just dispatches it.
 */
export function EscalationEditClient({
  escalation,
  teamMemberNames,
}: {
  escalation: EscalationRow;
  teamMemberNames: string[];
}) {
  const router = useRouter();
  const initial = escalationToEditState(escalation);
  const [editingAs, setEditingAs] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null
  );

  return (
    <EscalationEditForm
      initial={initial}
      teamMemberNames={teamMemberNames}
      editingAs={editingAs}
      onEditingAsChange={(v) => setEditingAs(v)}
      pending={pending}
      result={result}
      onSave={(next: EscalationEditState) => {
        if (!editingAs.trim()) {
          setResult({
            ok: false,
            message: "Pick an 'Editing as' identity first.",
          });
          return;
        }
        setResult(null);
        startTransition(async () => {
          const r = await updateEscalationAction({
            id: escalation.id,
            editingAs,
            ...next,
          });
          setResult({ ok: r.ok, message: r.message });
          if (r.ok) {
            // Hand off to server: rerender both the detail page (history
            // block + read-only context) and any list pages that
            // reference this row.
            router.refresh();
          }
        });
      }}
    />
  );
}
