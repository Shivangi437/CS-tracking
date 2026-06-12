/**
 * Centralised env reader. Always .trim() — Vercel sometimes appends \n.
 */

function read(name: string, required = true): string {
  const raw = process.env[name];
  const value = (raw ?? "").trim();
  if (required && !value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function readIdList(name: string, required = false): number[] {
  const raw = read(name, required);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      if (!Number.isFinite(n)) {
        throw new Error(`${name} contains non-numeric id: ${s}`);
      }
      return n;
    });
}

function readId(name: string, required = false): number | null {
  const raw = read(name, required);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a numeric Freshdesk id, got: ${raw}`);
  }
  return n;
}

export const env = {
  // Freshdesk
  get FRESHDESK_DOMAIN() {
    return read("FRESHDESK_DOMAIN");
  },
  get FRESHDESK_API_KEY() {
    return read("FRESHDESK_API_KEY");
  },
  /** IDs whose replies must NOT count as human replies. */
  get AI_AGENT_IDS(): number[] {
    return readIdList("AI_AGENT_IDS", false);
  },
  /** Optional: tickets still sitting with Rama are escalated-not-assigned. */
  get RAMA_AGENT_ID(): number | null {
    return readId("RAMA_AGENT_ID", false);
  },
  /**
   * Comma-separated agent IDs to exclude from the leaderboard entirely —
   * inactive teammates, people who've left, anyone not on the current
   * active CS roster. They still sync (so historical lookups work) but
   * never show up in /today, /week, /month, agent listings, or rollups.
   */
  get EXCLUDED_AGENT_IDS(): number[] {
    return readIdList("EXCLUDED_AGENT_IDS", false);
  },

  // Database
  get DATABASE_URL() {
    return read("DATABASE_URL");
  },

  // Email
  get RESEND_API_KEY() {
    return read("RESEND_API_KEY", false);
  },
  get SUMMARY_EMAIL_FROM() {
    return read("SUMMARY_EMAIL_FROM", false);
  },
  /** Comma-separated recipients. */
  get SUMMARY_EMAIL_TO(): string[] {
    return read("SUMMARY_EMAIL_TO", false)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },

  // Slack
  get SLACK_WEBHOOK_URL() {
    return read("SLACK_WEBHOOK_URL", false);
  },
  /** Bot token (xoxb-...) — used for DMs to credited agents + channel posts. */
  get SLACK_BOT_TOKEN() {
    return read("SLACK_BOT_TOKEN", false);
  },
  /** Channel ID (Cxxxx...) for the cs-escalations channel — also posts here. */
  get SLACK_ESCALATION_CHANNEL_ID() {
    return read("SLACK_ESCALATION_CHANNEL_ID", false);
  },
  /** Public origin of the dashboard, used to build links in DMs. */
  get DASHBOARD_ORIGIN() {
    return read("DASHBOARD_ORIGIN", false);
  },

  // Cron auth (still required — Vercel Cron + GitHub Actions send this header)
  get CRON_SECRET() {
    return read("CRON_SECRET");
  },
};
