/**
 * One-off smoke test for the escalation Slack notifier. Exercises the
 * exact code path that updateEscalationAction takes, with synthetic
 * triggers. No DB writes; no audit log row.
 *
 *   node --env-file=.env.local --import tsx scripts/test-slack.ts
 */

import { notifyEscalationUpdate } from "@/lib/slack-escalations";

async function main() {
  console.log("[test] firing notifyEscalationUpdate with all 3 triggers…");
  await notifyEscalationUpdate({
    escalation: {
      id: 1,
      authorName: "Sudhir Malik (TEST)",
      authorEmail: "sudhirmalik.msn@gmail.com",
      handle: null,
      issueText:
        "TEST ping from the Slack notifier — author copies delivery delay query, original message ~6 weeks old, surfaced via LinkedIn DM. This is a test, not a real update.",
    },
    triggers: {
      statusChanged: true,
      agentChanged: true,
      creditClassChanged: true,
      previousAgent: null,
      newAgent: "Karan Mandal",
      previousStatus: "open_unactioned",
      newStatus: "in_progress",
      previousCreditClass: "visibility",
      newCreditClass: "merit",
    },
  });
  console.log("[test] done.");
  console.log();
  console.log("Expected to land:");
  console.log("  - DM to Karan Mandal (U094H61EJJJ): '📌 now credited to you'");
  console.log("  - Channel post in #cs-escalations (C0BA666Q7PD)");
  console.log("");
  console.log("If you got the DM but no channel post, the bot is not in the channel yet —");
  console.log("invite with /invite @bookleaf_escalations in #cs-escalations.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
