"use server";

import { revalidatePath } from "next/cache";
import { sql, eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { escalations, escalationEdits, teamMembers } from "@/lib/db/schema";
import { deriveAll } from "@/lib/escalations";
import { notifyEscalationUpdate } from "@/lib/slack-escalations";

/**
 * Payload from the inline edit form. All fields the user can touch.
 * Server-derived flags (credit_class, escalation_type, is_public,
 * needs_attention) are NOT in this type — they're recomputed from the
 * inputs inside the action. Channel + medium are NOT editable (they
 * shouldn't change once an escalation is logged), but we read them
 * back from the DB for the derivation.
 */
export interface EscalationUpdateInput {
  id: number;
  /** Required — the team_members identity making this edit. Validated server-side. */
  editingAs: string;
  /**
   * The escalation's `updated_at` ISO string at the moment the form was
   * loaded. Used for optimistic concurrency: if another save lands
   * between load and save, the UPDATE's WHERE clause won't match and the
   * action returns a conflict instead of silently overwriting.
   * Optional only for backwards compatibility — clients should always send it.
   */
  baseUpdatedAt?: string;

  status: string;
  category: string;
  agent: string;
  remediation: string;
  notes: string;
  /** Plain text. NOT validated against Freshdesk. */
  freshdeskTicket: string;
  legalThreat: boolean;
  closureConfirmed: boolean;
  /** ISO datetime-local string ("yyyy-MM-ddTHH:mm") or empty. */
  acknowledgedAt: string;
  verifiedBy: string;
}

export interface EscalationUpdateResult {
  ok: boolean;
  message: string;
  /** What actually changed, for the caller to summarise. */
  changedFields?: string[];
  /** Whether server-derived flags also changed (notification trigger). */
  notifyTriggers?: {
    statusChanged: boolean;
    agentChanged: boolean;
    creditClassChanged: boolean;
    previousAgent: string | null;
    newAgent: string | null;
    previousStatus: string;
    newStatus: string;
    previousCreditClass: string;
    newCreditClass: string;
  };
}

/**
 * Update an escalation. Always re-derives credit_class, escalation_type,
 * needs_attention, is_public from the (new) status/category/etc. via
 * deriveAll(). The client cannot set any of those four — they come out
 * of one shared module so the merit-vs-visibility discipline stays
 * enforced.
 *
 * No Freshdesk API call anywhere. The freshdesk_ticket field is a
 * plain text string passed straight through.
 *
 * Returns notifyTriggers describing what changed in a way the caller
 * (commit 5) can use to drive Slack notifications. This action itself
 * does NOT send the notifications — that's the next layer's job.
 */
export async function updateEscalationAction(
  input: EscalationUpdateInput
): Promise<EscalationUpdateResult> {
  if (!Number.isFinite(input.id)) {
    return { ok: false, message: "Invalid escalation id." };
  }
  const editingAsName = input.editingAs?.trim() ?? "";
  if (!editingAsName) {
    return { ok: false, message: "Pick an 'Editing as' identity before saving." };
  }

  try {
    // Verify the "Editing as" name is a real, active team member. We don't
    // want anonymous strings polluting the audit trail. Case-insensitive
    // match because team_members.name is now LOWER-unique (migration 0005).
    const editor = await db
      .select({ name: teamMembers.name })
      .from(teamMembers)
      .where(
        and(
          sql`LOWER(${teamMembers.name}) = LOWER(${editingAsName})`,
          eq(teamMembers.active, true)
        )
      )
      .limit(1);
    if (editor.length === 0) {
      return {
        ok: false,
        message: `"${editingAsName}" is not on the active team roster. Add them at /admin/team first.`,
      };
    }
    // Use the canonical-cased name from the DB so the audit log is consistent.
    const editorCanonicalName = editor[0].name;

    // Read current row — we need channel + medium for derivation, and
    // the old field values for the diff/audit-log layer.
    const existing = await db
      .select()
      .from(escalations)
      .where(eq(escalations.id, input.id))
      .limit(1);

    if (existing.length === 0) {
      return { ok: false, message: `Escalation #${input.id} not found.` };
    }
    const prev = existing[0];

    // Optimistic concurrency: if the form was loaded against an older
    // version of the row, refuse the save. Comparing as ISO strings so
    // serialisation drift doesn't false-positive.
    if (input.baseUpdatedAt) {
      const dbUpdatedAt = new Date(prev.updatedAt).toISOString();
      if (dbUpdatedAt !== input.baseUpdatedAt) {
        return {
          ok: false,
          message:
            "Someone else updated this escalation while you had it open. Reload the page to see their changes, then re-apply yours.",
        };
      }
    }

    // Normalise inputs.
    const status = input.status.trim();
    const category = input.category.trim() || null;
    const agent = input.agent.trim() || null;
    const remediation = input.remediation.trim() || null;
    const notes = input.notes.trim() || null;
    const freshdeskTicket = input.freshdeskTicket.trim() || null;
    const verifiedBy = input.verifiedBy.trim() || null;
    const acknowledgedAt = parseDatetimeLocal(input.acknowledgedAt);

    // Server-side re-derivation. Note: the issueText used here is the
    // CURRENT (DB) issue text, because issue text is not editable. The
    // pile-on detection only kicks in for short "same here" style
    // comments — historic issueText doesn't drift, so this is safe.
    const derived = deriveAll({
      channel: prev.channel,
      medium: prev.medium,
      issueText: prev.issueText,
      status,
    });

    // Diff: what actually changed?
    const changedFields = collectChanges(prev, {
      status,
      category,
      agent,
      remediation,
      notes,
      freshdeskTicket,
      verifiedBy,
      acknowledgedAt: acknowledgedAt ? acknowledgedAt.toISOString() : null,
      legalThreat: input.legalThreat,
      closureConfirmed: input.closureConfirmed,
      creditClass: derived.creditClass,
      escalationType: derived.escalationType,
      isPublic: derived.isPublic,
      needsAttention: derived.needsAttention,
    });

    if (changedFields.length === 0) {
      return { ok: true, message: "No changes to save.", changedFields: [] };
    }

    // Persist + audit log in the same logical operation. Drizzle's
    // neon-http driver doesn't expose a transaction handle, so we sequence
    // the UPDATE then the INSERT-batch. Audit failures don't roll back the
    // edit (per spec, the dashboard still works without a perfect log),
    // but they're rare — the audit table has no constraints to violate.
    // UPDATE with optimistic-concurrency clause: only apply if the row's
    // updated_at still matches what we loaded. Returns the affected row's
    // updated_at so we can confirm we won the race; if no row returns the
    // user lost the race and another save overwrote us.
    const updated = await db
      .update(escalations)
      .set({
        status,
        category,
        agent,
        remediation,
        notes,
        freshdeskTicket,
        verifiedBy,
        acknowledgedAt,
        legalThreat: input.legalThreat,
        closureConfirmed: input.closureConfirmed,
        creditClass: derived.creditClass,
        escalationType: derived.escalationType,
        isPublic: derived.isPublic,
        needsAttention: derived.needsAttention,
        // If status became 'resolved' and there's no resolved_at yet, stamp it.
        // (Never clear an existing resolved_at — that history stays.)
        resolvedAt: sql`
          CASE
            WHEN ${status} = 'resolved' AND ${escalations.resolvedAt} IS NULL
              THEN NOW()
            ELSE ${escalations.resolvedAt}
          END
        `,
        updatedAt: sql`NOW()`,
      })
      .where(
        input.baseUpdatedAt
          ? and(
              eq(escalations.id, input.id),
              sql`${escalations.updatedAt} = ${prev.updatedAt}`
            )
          : eq(escalations.id, input.id)
      )
      .returning({ id: escalations.id });

    if (updated.length === 0) {
      // Lost the optimistic race. Per spec, never silently overwrite.
      return {
        ok: false,
        message:
          "Save conflicted with another edit. Reload to see the latest state then try again.",
      };
    }

    // Audit log: one row per changed field. Old/new are stringified to
    // text so historic comparisons work even after schema changes. Use
    // the DB-canonical cased name so audit entries are consistent
    // regardless of how the user typed the dropdown value.
    const editedBy = editorCanonicalName;
    const auditRows = changedFields.map((field) => ({
      escalationId: input.id,
      editedBy,
      fieldName: field,
      oldValue: serialiseField(prev, field),
      newValue: serialiseNext(field, {
        status,
        category,
        agent,
        remediation,
        notes,
        freshdeskTicket,
        verifiedBy,
        acknowledgedAt: acknowledgedAt ? acknowledgedAt.toISOString() : null,
        legalThreat: input.legalThreat,
        closureConfirmed: input.closureConfirmed,
        creditClass: derived.creditClass,
        escalationType: derived.escalationType,
        isPublic: derived.isPublic,
        needsAttention: derived.needsAttention,
      }),
    }));
    if (auditRows.length > 0) {
      await db.insert(escalationEdits).values(auditRows).catch((err) => {
        // Audit failure shouldn't block the user save — log it and move on.
        console.error(
          "[escalation-update] audit log insert failed:",
          err instanceof Error ? err.message : err
        );
      });
    }

    revalidatePath("/escalations");
    revalidatePath(`/escalations/${input.id}`);
    revalidatePath("/agents");

    // Slack notification: fire-and-forget. The function itself never
    // throws (try/catch internally) and we don't await it here so a
    // Slack outage or rate limit can't slow down the save response.
    // Only DMs on status / agent / credit_class changes — exactly the
    // triggers in the spec.
    const notifyTriggers = {
      statusChanged: prev.status !== status,
      agentChanged: (prev.agent ?? "") !== (agent ?? ""),
      creditClassChanged: prev.creditClass !== derived.creditClass,
      previousAgent: prev.agent ?? null,
      newAgent: agent,
      previousStatus: prev.status,
      newStatus: status,
      previousCreditClass: prev.creditClass,
      newCreditClass: derived.creditClass,
    };
    void notifyEscalationUpdate({
      escalation: {
        id: prev.id,
        authorName: prev.authorName,
        authorEmail: prev.authorEmail,
        handle: prev.handle,
        issueText: prev.issueText,
      },
      triggers: notifyTriggers,
    });

    return {
      ok: true,
      message: `Saved (${changedFields.length} field${
        changedFields.length === 1 ? "" : "s"
      } changed).`,
      changedFields,
      notifyTriggers: {
        statusChanged: prev.status !== status,
        agentChanged: (prev.agent ?? "") !== (agent ?? ""),
        creditClassChanged: prev.creditClass !== derived.creditClass,
        previousAgent: prev.agent ?? null,
        newAgent: agent,
        previousStatus: prev.status,
        newStatus: status,
        previousCreditClass: prev.creditClass,
        newCreditClass: derived.creditClass,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Compare current values against the previous DB row and return the
 * list of changed field names (camelCase). Used by the audit log in
 * commit 4 and by the notification dispatcher in commit 5.
 */
function collectChanges(
  prev: typeof escalations.$inferSelect,
  next: {
    status: string;
    category: string | null;
    agent: string | null;
    remediation: string | null;
    notes: string | null;
    freshdeskTicket: string | null;
    verifiedBy: string | null;
    acknowledgedAt: string | null;
    legalThreat: boolean;
    closureConfirmed: boolean;
    creditClass: string;
    escalationType: string;
    isPublic: boolean;
    needsAttention: boolean;
  }
): string[] {
  const out: string[] = [];
  const cmp = (key: string, a: unknown, b: unknown) => {
    if ((a ?? null) !== (b ?? null)) out.push(key);
  };
  cmp("status", prev.status, next.status);
  cmp("category", prev.category, next.category);
  cmp("agent", prev.agent, next.agent);
  cmp("remediation", prev.remediation, next.remediation);
  cmp("notes", prev.notes, next.notes);
  cmp("freshdeskTicket", prev.freshdeskTicket, next.freshdeskTicket);
  cmp("verifiedBy", prev.verifiedBy, next.verifiedBy);
  cmp("legalThreat", prev.legalThreat, next.legalThreat);
  cmp("closureConfirmed", prev.closureConfirmed, next.closureConfirmed);
  cmp("creditClass", prev.creditClass, next.creditClass);
  cmp("escalationType", prev.escalationType, next.escalationType);
  cmp("isPublic", prev.isPublic, next.isPublic);
  cmp("needsAttention", prev.needsAttention, next.needsAttention);
  // acknowledgedAt — datetime-local inputs are minute-resolution, but
  // the DB may store seconds (from a previous full timestamp insert).
  // Round both sides to the minute before comparing so a no-op save
  // doesn't false-positive on the seconds.
  const prevAck = roundIsoToMinute(
    prev.acknowledgedAt ? new Date(prev.acknowledgedAt).toISOString() : null
  );
  const nextAck = roundIsoToMinute(next.acknowledgedAt);
  if (prevAck !== nextAck) out.push("acknowledgedAt");
  return out;
}

/**
 * Truncate an ISO string to minute resolution ("yyyy-MM-ddTHH:mmZ").
 * Used by the acknowledgedAt diff so an unchanged minute doesn't
 * register as changed when the stored value carries seconds.
 */
function roundIsoToMinute(iso: string | null): string | null {
  if (iso == null) return null;
  return iso.slice(0, 16);
}

/**
 * Parse a "yyyy-MM-ddTHH:mm" (datetime-local input) string into a Date.
 * Treats the input as IST wall-clock and converts to UTC for storage.
 */
function parseDatetimeLocal(s: string): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null;
  // Append IST offset so the user-typed wall-clock survives the round trip.
  const d = new Date(s + ":00+05:30");
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Stringify the previous DB row's value of a given field for audit. */
function serialiseField(
  prev: typeof escalations.$inferSelect,
  field: string
): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (prev as any)[field];
  return serialiseValue(v);
}

function serialiseNext(
  field: string,
  next: Record<string, unknown>
): string | null {
  return serialiseValue(next[field]);
}

function serialiseValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
