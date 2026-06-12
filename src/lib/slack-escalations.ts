/**
 * Slack notifications for escalation updates.
 *
 * Triggers — EXACTLY these three, per spec:
 *   1. Status change         → DM the credited agent
 *   2. Agent reassignment    → DM the NEW agent ("now credited to you")
 *                              AND DM the OLD agent ("credit moved away")
 *   3. Credit class flip     → DM the credited agent
 *      (merit ↔ visibility)
 *
 * Same payload also posted to SLACK_ESCALATION_CHANNEL_ID so managers
 * see everything in one place.
 *
 * NOT triggered on: notes, remediation, category, ticket reference,
 * legal threat flag, closure confirmed, acknowledged_at, verified_by.
 *
 * Fire-and-forget: every send is wrapped in try/catch. A Slack outage or
 * bad member ID never blocks or fails the underlying save — failures
 * only go to console.error.
 *
 * NO Freshdesk API calls. Reads only `team_members.slack_member_id`
 * by agent name.
 */

import { env } from "@/lib/env";
import { getSlackMemberIdForName } from "@/lib/team-members";

const SLACK_API = "https://slack.com/api";

interface EscalationContext {
  id: number;
  authorName: string | null;
  authorEmail: string | null;
  handle: string | null;
  issueText: string | null;
}

interface NotifyArgs {
  escalation: EscalationContext;
  triggers: {
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
 * Entry point. Inspects which triggers fired and dispatches the
 * appropriate DMs + channel post. Fully fire-and-forget — never throws.
 */
export async function notifyEscalationUpdate(args: NotifyArgs): Promise<void> {
  try {
    const token = env.SLACK_BOT_TOKEN;
    const channel = env.SLACK_ESCALATION_CHANNEL_ID;
    if (!token) {
      console.log("[slack] SLACK_BOT_TOKEN not set — skipping notification");
      return;
    }

    const { triggers, escalation } = args;
    const anyTrigger =
      triggers.statusChanged ||
      triggers.agentChanged ||
      triggers.creditClassChanged;
    if (!anyTrigger) return;

    const detailUrl = buildDetailUrl(escalation.id);

    // DM target(s) — set so we don't DM the same person twice if multiple
    // triggers fire and the agent overlaps.
    const dmTargets = new Map<
      string,
      { name: string; reason: "current_owner" | "new_owner" | "former_owner" }
    >();

    if (triggers.agentChanged) {
      // Spec: DM both new AND old agent on reassignment.
      if (triggers.newAgent) {
        dmTargets.set(triggers.newAgent.toLowerCase(), {
          name: triggers.newAgent,
          reason: "new_owner",
        });
      }
      if (triggers.previousAgent && triggers.previousAgent !== triggers.newAgent) {
        dmTargets.set(triggers.previousAgent.toLowerCase(), {
          name: triggers.previousAgent,
          reason: "former_owner",
        });
      }
    }
    if (triggers.statusChanged || triggers.creditClassChanged) {
      // DM the current (possibly new) owner. Set semantics dedupe with the
      // agent_changed entry above.
      const owner = triggers.newAgent ?? triggers.previousAgent ?? null;
      if (owner && !dmTargets.has(owner.toLowerCase())) {
        dmTargets.set(owner.toLowerCase(), {
          name: owner,
          reason: "current_owner",
        });
      }
    }

    const tasks: Promise<unknown>[] = [];

    for (const { name, reason } of dmTargets.values()) {
      tasks.push(sendDm(token, name, reason, args, detailUrl));
    }

    if (channel) {
      tasks.push(postToChannel(token, channel, args, detailUrl));
    }

    // Fire-and-forget: settle all, log failures. Never throws upstream.
    await Promise.allSettled(tasks);
  } catch (err) {
    console.error(
      "[slack] notifyEscalationUpdate failed silently:",
      err instanceof Error ? err.message : err
    );
  }
}

async function sendDm(
  token: string,
  agentName: string,
  reason: "current_owner" | "new_owner" | "former_owner",
  args: NotifyArgs,
  detailUrl: string
): Promise<void> {
  try {
    const userId = await getSlackMemberIdForName(agentName);
    if (!userId) {
      console.log(
        `[slack] no slack_member_id for "${agentName}" — DM skipped (add via /admin/team)`
      );
      return;
    }
    const blocks = buildBlocks(args, detailUrl, { audience: "dm", reason });
    const r = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: userId,
        text: dmFallbackText(args, reason),
        blocks,
      }),
    });
    const data = (await r.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error(
        `[slack] DM to ${agentName} (${userId}) failed: ${data.error}`
      );
    }
  } catch (err) {
    console.error(
      `[slack] DM to ${agentName} threw silently:`,
      err instanceof Error ? err.message : err
    );
  }
}

async function postToChannel(
  token: string,
  channel: string,
  args: NotifyArgs,
  detailUrl: string
): Promise<void> {
  try {
    const blocks = buildBlocks(args, detailUrl, { audience: "channel" });
    const r = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        text: channelFallbackText(args),
        blocks,
      }),
    });
    const data = (await r.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error(
        `[slack] channel post to ${channel} failed: ${data.error}`
      );
    }
  } catch (err) {
    console.error(
      `[slack] channel post threw silently:`,
      err instanceof Error ? err.message : err
    );
  }
}

// ---------- message rendering ----------

function buildBlocks(
  args: NotifyArgs,
  detailUrl: string,
  opts:
    | { audience: "dm"; reason: "current_owner" | "new_owner" | "former_owner" }
    | { audience: "channel" }
): unknown[] {
  const { escalation, triggers } = args;
  const author =
    escalation.authorName ??
    escalation.authorEmail ??
    escalation.handle ??
    "Unknown author";
  const issueSnippet = (escalation.issueText ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  const headerText =
    opts.audience === "dm"
      ? dmHeader(opts.reason, escalation.id)
      : `Escalation #${escalation.id} updated`;

  const changeLines: string[] = [];
  if (triggers.agentChanged) {
    changeLines.push(
      `*Credited agent:* ${fmtAgent(triggers.previousAgent)} → ${fmtAgent(
        triggers.newAgent
      )}`
    );
  }
  if (triggers.statusChanged) {
    changeLines.push(
      `*Status:* ${humanStatus(triggers.previousStatus)} → ${humanStatus(
        triggers.newStatus
      )}`
    );
  }
  if (triggers.creditClassChanged) {
    changeLines.push(
      `*Credit class:* ${triggers.previousCreditClass} → *${triggers.newCreditClass}*`
    );
  }

  return [
    {
      type: "header",
      text: { type: "plain_text", text: headerText },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: changeLines.join("\n"),
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Author:* ${escape(author)}` },
        { type: "mrkdwn", text: `*Issue:* ${escape(issueSnippet) || "—"}` },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in dashboard" },
          url: detailUrl,
        },
      ],
    },
  ];
}

function dmHeader(
  reason: "current_owner" | "new_owner" | "former_owner",
  id: number
): string {
  switch (reason) {
    case "new_owner":
      return `📌 Escalation #${id} is now credited to you`;
    case "former_owner":
      return `🔁 Credit on escalation #${id} moved away from you`;
    case "current_owner":
    default:
      return `🔔 Your escalation #${id} was updated`;
  }
}

function dmFallbackText(
  args: NotifyArgs,
  reason: "current_owner" | "new_owner" | "former_owner"
): string {
  const { escalation, triggers } = args;
  const head = dmHeader(reason, escalation.id).replace(/^\W+\s*/, "");
  const bits: string[] = [head];
  if (triggers.statusChanged) {
    bits.push(`status ${triggers.previousStatus} → ${triggers.newStatus}`);
  }
  if (triggers.creditClassChanged) {
    bits.push(
      `credit ${triggers.previousCreditClass} → ${triggers.newCreditClass}`
    );
  }
  return bits.join(" · ");
}

function channelFallbackText(args: NotifyArgs): string {
  const { escalation, triggers } = args;
  const head = `Escalation #${escalation.id} updated`;
  const bits: string[] = [head];
  if (triggers.agentChanged) {
    bits.push(
      `agent ${fmtAgent(triggers.previousAgent)} → ${fmtAgent(triggers.newAgent)}`
    );
  }
  if (triggers.statusChanged) {
    bits.push(`status ${triggers.previousStatus} → ${triggers.newStatus}`);
  }
  if (triggers.creditClassChanged) {
    bits.push(
      `credit ${triggers.previousCreditClass} → ${triggers.newCreditClass}`
    );
  }
  return bits.join(" · ");
}

function buildDetailUrl(id: number): string {
  const origin =
    env.DASHBOARD_ORIGIN ||
    "https://support-performance-tracker.vercel.app";
  return `${origin.replace(/\/$/, "")}/escalations/${id}`;
}

function humanStatus(s: string): string {
  return s.replace(/_/g, " ");
}

function fmtAgent(a: string | null): string {
  return a && a.trim() ? a.trim() : "_unassigned_";
}

function escape(s: string): string {
  // Minimal Slack mrkdwn escapes for &, <, > so author emails / issue
  // snippets don't accidentally trip Slack formatting.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
