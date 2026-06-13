"use server";

import { revalidatePath } from "next/cache";
import { sql, eq, asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teamMembers } from "@/lib/db/schema";

export interface TeamMember {
  id: number;
  name: string;
  slackMemberId: string | null;
  active: boolean;
}

/** All rows, alphabetical. Inactive ones are kept (with a flag) so the
 *  audit log can still resolve old names. */
export async function listTeamMembers(): Promise<TeamMember[]> {
  return db
    .select({
      id: teamMembers.id,
      name: teamMembers.name,
      slackMemberId: teamMembers.slackMemberId,
      active: teamMembers.active,
    })
    .from(teamMembers)
    .orderBy(asc(teamMembers.name));
}

/** Just the active names — feeds dropdowns + the "Editing as" selector. */
export async function listActiveTeamMemberNames(): Promise<string[]> {
  const rows = await db
    .select({ name: teamMembers.name })
    .from(teamMembers)
    .where(eq(teamMembers.active, true))
    .orderBy(asc(teamMembers.name));
  return rows.map((r) => r.name);
}

/** Look up a Slack member id by name. Returns null if unknown or empty. */
export async function getSlackMemberIdForName(
  name: string
): Promise<string | null> {
  if (!name.trim()) return null;
  const r = await db
    .select({ slackMemberId: teamMembers.slackMemberId })
    .from(teamMembers)
    .where(sql`LOWER(${teamMembers.name}) = LOWER(${name.trim()})`)
    .limit(1);
  return r[0]?.slackMemberId ?? null;
}

// ---------- Mutations (server actions) ----------

export interface UpsertTeamMemberInput {
  /** Omit for create, supply for edit. */
  id?: number;
  name: string;
  slackMemberId: string;
  active: boolean;
}

export interface UpsertResult {
  ok: boolean;
  message: string;
  id?: number;
}

/**
 * Create or update a team member. Name is unique case-insensitively —
 * enforced both at the DB layer (LOWER(name) functional unique index,
 * migration 0005) and re-checked in the action for a friendlier error
 * message than "23505".
 */
export async function upsertTeamMemberAction(
  input: UpsertTeamMemberInput
): Promise<UpsertResult> {
  const name = input.name.trim();
  const slackMemberId = input.slackMemberId.trim() || null;
  if (!name) return { ok: false, message: "Name is required." };

  try {
    if (input.id == null) {
      const r = await db
        .insert(teamMembers)
        .values({
          name,
          slackMemberId,
          active: input.active,
        })
        .returning({ id: teamMembers.id });
      revalidatePath("/admin/team");
      return {
        ok: true,
        message: `Added ${name}.`,
        id: r[0].id,
      };
    }

    await db
      .update(teamMembers)
      .set({
        name,
        slackMemberId,
        active: input.active,
        updatedAt: sql`NOW()`,
      })
      .where(eq(teamMembers.id, input.id));
    revalidatePath("/admin/team");
    return { ok: true, message: `Updated ${name}.`, id: input.id };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (m.includes("team_members_name_idx") || m.includes("23505")) {
      return { ok: false, message: `A team member named "${name}" already exists.` };
    }
    return { ok: false, message: m };
  }
}

export async function deleteTeamMemberAction(
  id: number
): Promise<UpsertResult> {
  try {
    await db.delete(teamMembers).where(eq(teamMembers.id, id));
    revalidatePath("/admin/team");
    return { ok: true, message: "Removed." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
