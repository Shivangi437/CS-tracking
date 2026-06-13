/**
 * End-to-end smoke test for the audit-driven bug fixes.
 * Read-only where possible, harmless writes where not.
 *
 *   node --env-file=.env.local --import tsx scripts/test-bugfixes.ts
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { teamMembers, escalations, escalationEdits } from "@/lib/db/schema";
import { getSlackMemberIdForName } from "@/lib/team-members";
import { updateEscalationAction } from "@/lib/escalation-update";

const PASS = "✅";
const FAIL = "❌";
const SKIP = "⏭️";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, details = "") {
  if (ok) {
    pass++;
    console.log(`${PASS} ${label}${details ? ` — ${details}` : ""}`);
  } else {
    fail++;
    console.log(`${FAIL} ${label}${details ? ` — ${details}` : ""}`);
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("Bug-fix smoke test");
  console.log("=".repeat(70));
  console.log();

  // ===================================================================
  // FIX 1: case-insensitive unique on team_members.name
  // ===================================================================
  console.log("\n--- Fix 1: case-insensitive unique on team_members.name ---");
  const dupName = "TestCaseDup_" + Math.floor(Math.random() * 100000);
  try {
    await db.insert(teamMembers).values({
      name: dupName,
      slackMemberId: null,
      active: false,
    });
    // Now try the same name in different case — should fail.
    let didFail = false;
    try {
      await db.insert(teamMembers).values({
        name: dupName.toLowerCase(),
        slackMemberId: null,
        active: false,
      });
    } catch (err) {
      didFail = true;
      check(
        "Duplicate name in different case is rejected by DB",
        true,
        err instanceof Error ? err.message.slice(0, 60) : ""
      );
    }
    if (!didFail) {
      check("Duplicate name in different case is rejected by DB", false);
    }
  } finally {
    // Clean up the test row.
    await db
      .delete(teamMembers)
      .where(sql`LOWER(${teamMembers.name}) = LOWER(${dupName})`);
  }

  // ===================================================================
  // FIX 3: editingAs validation
  // ===================================================================
  console.log("\n--- Fix 3: editingAs must be an active team member ---");
  // Pick a real escalation to operate on.
  const someEsc = await db
    .select()
    .from(escalations)
    .limit(1);
  if (someEsc.length === 0) {
    console.log(`${SKIP} no escalations in DB; skipping update-action tests`);
  } else {
    const e = someEsc[0];

    // Bogus name → reject.
    const bogus = await updateEscalationAction({
      id: e.id,
      editingAs: "Not A Real Person 12345",
      baseUpdatedAt: new Date(e.updatedAt).toISOString(),
      status: e.status,
      category: e.category ?? "",
      agent: e.agent ?? "",
      remediation: e.remediation ?? "",
      notes: e.notes ?? "",
      freshdeskTicket: e.freshdeskTicket ?? "",
      legalThreat: e.legalThreat,
      closureConfirmed: e.closureConfirmed,
      acknowledgedAt: "",
      verifiedBy: e.verifiedBy ?? "",
    }).catch((err) => ({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }));
    check(
      "Bogus editingAs is rejected",
      !bogus.ok && bogus.message.includes("not on the active team roster"),
      bogus.message
    );

    // Real (lowercased) name → accepted via case-insensitive lookup.
    const validMixedCase = await updateEscalationAction({
      id: e.id,
      editingAs: "karan mandal", // lowercased on purpose
      baseUpdatedAt: new Date(e.updatedAt).toISOString(),
      status: e.status,
      category: e.category ?? "",
      agent: e.agent ?? "",
      remediation: e.remediation ?? "",
      notes: e.notes ?? "",
      freshdeskTicket: e.freshdeskTicket ?? "",
      legalThreat: e.legalThreat,
      closureConfirmed: e.closureConfirmed,
      acknowledgedAt: e.acknowledgedAt
        ? toLocalIstMinute(new Date(e.acknowledgedAt))
        : "",
      verifiedBy: e.verifiedBy ?? "",
    }).catch((err) => ({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      changedFields: undefined,
    }));
    check(
      "Active team member 'karan mandal' (lowercased) is accepted",
      validMixedCase.ok,
      validMixedCase.message
    );
    check(
      "No-op save reports zero changedFields (acknowledgedAt rounding works)",
      validMixedCase.ok &&
        Array.isArray(validMixedCase.changedFields) &&
        validMixedCase.changedFields.length === 0,
      `changedFields=${JSON.stringify(validMixedCase.changedFields)}`
    );

    // ===================================================================
    // FIX 2: optimistic locking
    // ===================================================================
    console.log("\n--- Fix 2: optimistic locking on stale baseUpdatedAt ---");
    // After the previous no-op save, e.updatedAt is now stale (server
    // bumped updated_at on the row even though no fields changed —
    // actually a no-op doesn't reach UPDATE, so updated_at didn't bump;
    // let's force a real change to advance the row's updated_at first.

    // Read freshest state, make a notes edit, save.
    const freshA = await db
      .select()
      .from(escalations)
      .where(sql`${escalations.id} = ${e.id}`)
      .limit(1);
    const noteSentinel = `auto-test-stale-${Math.floor(Math.random() * 1000)}`;
    const r1 = await updateEscalationAction({
      id: e.id,
      editingAs: "Karan Mandal",
      baseUpdatedAt: new Date(freshA[0].updatedAt).toISOString(),
      status: freshA[0].status,
      category: freshA[0].category ?? "",
      agent: freshA[0].agent ?? "",
      remediation: freshA[0].remediation ?? "",
      notes: noteSentinel,
      freshdeskTicket: freshA[0].freshdeskTicket ?? "",
      legalThreat: freshA[0].legalThreat,
      closureConfirmed: freshA[0].closureConfirmed,
      acknowledgedAt: freshA[0].acknowledgedAt
        ? toLocalIstMinute(new Date(freshA[0].acknowledgedAt))
        : "",
      verifiedBy: freshA[0].verifiedBy ?? "",
    }).catch((err) => ({ ok: false, message: err instanceof Error ? err.message : String(err) }));
    check("Real edit succeeds (notes touched)", r1.ok, r1.message);

    // Now attempt to save again with the OLD baseUpdatedAt — should conflict.
    const conflict = await updateEscalationAction({
      id: e.id,
      editingAs: "Karan Mandal",
      baseUpdatedAt: new Date(freshA[0].updatedAt).toISOString(), // stale!
      status: freshA[0].status,
      category: freshA[0].category ?? "",
      agent: freshA[0].agent ?? "",
      remediation: freshA[0].remediation ?? "",
      notes: "would-overwrite-but-shouldnt",
      freshdeskTicket: freshA[0].freshdeskTicket ?? "",
      legalThreat: freshA[0].legalThreat,
      closureConfirmed: freshA[0].closureConfirmed,
      acknowledgedAt: freshA[0].acknowledgedAt
        ? toLocalIstMinute(new Date(freshA[0].acknowledgedAt))
        : "",
      verifiedBy: freshA[0].verifiedBy ?? "",
    }).catch((err) => ({ ok: false, message: err instanceof Error ? err.message : String(err) }));
    check(
      "Stale baseUpdatedAt is REJECTED (optimistic lock works)",
      !conflict.ok &&
        (conflict.message.toLowerCase().includes("conflict") ||
          conflict.message.toLowerCase().includes("reload")),
      conflict.message
    );

    // Verify the row still has the FIRST edit's value, not the second
    // attempt's "would-overwrite" value.
    const afterConflict = await db
      .select({ notes: escalations.notes })
      .from(escalations)
      .where(sql`${escalations.id} = ${e.id}`)
      .limit(1);
    check(
      "Original edit survived; conflicting save did NOT overwrite",
      afterConflict[0]?.notes === noteSentinel,
      `notes=${afterConflict[0]?.notes?.slice(0, 50)}`
    );

    // Restore notes to whatever they were before our test edit.
    const restoreFresh = await db
      .select()
      .from(escalations)
      .where(sql`${escalations.id} = ${e.id}`)
      .limit(1);
    await updateEscalationAction({
      id: e.id,
      editingAs: "Karan Mandal",
      baseUpdatedAt: new Date(restoreFresh[0].updatedAt).toISOString(),
      status: restoreFresh[0].status,
      category: restoreFresh[0].category ?? "",
      agent: restoreFresh[0].agent ?? "",
      remediation: restoreFresh[0].remediation ?? "",
      notes: freshA[0].notes ?? "",
      freshdeskTicket: restoreFresh[0].freshdeskTicket ?? "",
      legalThreat: restoreFresh[0].legalThreat,
      closureConfirmed: restoreFresh[0].closureConfirmed,
      acknowledgedAt: restoreFresh[0].acknowledgedAt
        ? toLocalIstMinute(new Date(restoreFresh[0].acknowledgedAt))
        : "",
      verifiedBy: restoreFresh[0].verifiedBy ?? "",
    }).catch(() => null);
    // Clean up the audit rows that this test pumped out.
    await db
      .delete(escalationEdits)
      .where(sql`${escalationEdits.escalationId} = ${e.id} AND ${escalationEdits.editedBy} = 'Karan Mandal' AND ${escalationEdits.editedAt} > NOW() - INTERVAL '5 minutes'`);
    console.log(`   (cleaned up test audit rows for escalation #${e.id})`);
  }

  // ===================================================================
  // FIX 5: Slack lookup tolerates whitespace + case
  // ===================================================================
  console.log("\n--- Fix 5: Slack name lookup tolerates whitespace + case ---");
  const exact = await getSlackMemberIdForName("Karan Mandal");
  const lower = await getSlackMemberIdForName("karan mandal");
  const padded = await getSlackMemberIdForName("  Karan  Mandal  ");
  const empty = await getSlackMemberIdForName("");
  const garbage = await getSlackMemberIdForName("Unknown Person 999");
  check("Exact name resolves to Slack ID", !!exact, `${exact}`);
  check("Lowercased name resolves to same ID", lower === exact, `${lower}`);
  check("Padded/double-space name resolves to same ID", padded === exact, `${padded}`);
  check("Empty string returns null", empty === null);
  check("Unknown name returns null", garbage === null);

  // ===================================================================
  // RESULTS
  // ===================================================================
  console.log();
  console.log("=".repeat(70));
  console.log(`Results: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(70));
  process.exit(fail > 0 ? 1 : 0);
}

function toLocalIstMinute(d: Date): string {
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 16);
}

main().catch((err) => {
  console.error("test runner crashed:", err);
  process.exit(2);
});
