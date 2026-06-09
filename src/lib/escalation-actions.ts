"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { escalations } from "@/lib/db/schema";
import { deriveAll, normaliseEmail } from "@/lib/escalations";

export interface CreateEscalationInput {
  channel: string;
  medium: string;
  status: string;
  category?: string;
  authorEmail?: string;
  handle?: string;
  authorName?: string;
  issueText: string;
  agent: string;
  freshdeskTicket?: string;
  remediation?: string;
  notes?: string;
  legalThreat?: boolean;
  openedAt?: string; // yyyy-MM-dd
}

export interface CreateEscalationResult {
  ok: boolean;
  message: string;
  id?: number;
}

export async function createEscalationAction(
  raw: CreateEscalationInput
): Promise<CreateEscalationResult> {
  // ----- Validate user-controlled mandatories -----
  const channel = (raw.channel || "").trim();
  const medium = (raw.medium || "").trim() || null;
  const issueText = (raw.issueText || "").trim();
  const agent = (raw.agent || "").trim();
  const status = (raw.status || "unlogged").trim();
  const authorEmail = normaliseEmail(raw.authorEmail);
  const handle = (raw.handle || "").trim() || null;

  if (!channel) return { ok: false, message: "Channel is required." };
  if (!medium) return { ok: false, message: "Medium is required." };
  if (!issueText) return { ok: false, message: "Describe the issue." };
  if (!agent) return { ok: false, message: "Credited executive is required." };
  if (!authorEmail && !handle)
    return {
      ok: false,
      message: "Provide author email OR social handle.",
    };

  // ----- Derive server-controlled flags -----
  const derived = deriveAll({ channel, medium, issueText, status });

  const openedAt =
    raw.openedAt && /^\d{4}-\d{2}-\d{2}$/.test(raw.openedAt)
      ? raw.openedAt
      : null;

  try {
    const r = await db
      .insert(escalations)
      .values({
        channel,
        medium,
        status,
        category: raw.category?.trim() || null,
        authorName: raw.authorName?.trim() || null,
        authorEmail,
        handle,
        issueText,
        agent,
        freshdeskTicket: raw.freshdeskTicket?.trim() || null,
        remediation: raw.remediation?.trim() || null,
        notes: raw.notes?.trim() || null,
        legalThreat: !!raw.legalThreat,
        openedAt,
        // Server-derived flags — never trust the client for these.
        isPublic: derived.isPublic,
        escalationType: derived.escalationType,
        creditClass: derived.creditClass,
        needsAttention: derived.needsAttention,
      })
      .returning({ id: escalations.id });

    revalidatePath("/escalations");
    revalidatePath("/agents");

    return {
      ok: true,
      message: `Logged escalation #${r[0].id} (${derived.creditClass}, ${derived.escalationType})`,
      id: r[0].id,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
