"use client";

import { useState } from "react";
import {
  EscalationEditForm,
  type EscalationEditState,
  escalationToEditState,
} from "@/components/EscalationEditForm";
import type { EscalationRow } from "@/lib/queries";

/**
 * Thin wrapper around EscalationEditForm that owns the "Editing as"
 * dropdown state and the save-result message. The actual save action
 * gets wired in commit 4 — until then onSave shows a placeholder.
 */
export function EscalationEditClient({
  escalation,
  teamMemberNames,
}: {
  escalation: EscalationRow;
  teamMemberNames: string[];
}) {
  const initial = escalationToEditState(escalation);
  const [editingAs, setEditingAs] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null
  );

  return (
    <EscalationEditForm
      initial={initial}
      teamMemberNames={teamMemberNames}
      editingAs={editingAs}
      onEditingAsChange={(v) => setEditingAs(v)}
      result={result}
      onSave={async (_next: EscalationEditState) => {
        // TODO (commit 4): wire updateEscalationAction here. For now the
        // dropdown + save button exist and validate the user has picked
        // an "Editing as" identity, but no DB write happens.
        setResult({
          ok: false,
          message: "Save not wired up yet — coming in commit 4.",
        });
      }}
    />
  );
}
