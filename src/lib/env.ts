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

  // Cron auth (still required — Vercel Cron + GitHub Actions send this header)
  get CRON_SECRET() {
    return read("CRON_SECRET");
  },
};
