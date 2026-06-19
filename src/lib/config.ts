/**
 * Single source of truth for tunable constants. Edit weights here to retune
 * the leaderboard without touching logic.
 */

export const TIMEZONE = "Asia/Kolkata";

/**
 * The two Freshdesk support portals, modelled as Freshdesk "Products".
 * There are exactly two products in the account — "None" and "bestseller" —
 * so a ticket's product_id cleanly splits them:
 *   product_id IS NULL  → "usual"      (the default / "None" product)
 *   product_id NOT NULL → "bestseller" (the premium product)
 *
 * Targets are tunable. `backlogCap` is the max acceptable Open+Pending the
 * team should be holding at any moment; `dailyResolveTarget` is the resolved-
 * per-IST-day goal. The /backlog view flags green/red against these.
 */
export const PORTAL_TARGETS = {
  usual: { label: "Usual", backlogCap: 25, dailyResolveTarget: 40 },
  bestseller: { label: "Bestseller", backlogCap: 15, dailyResolveTarget: 20 },
} as const;

export type PortalKey = keyof typeof PORTAL_TARGETS;

/** Ordered list of portal keys for stable rendering. */
export const PORTAL_KEYS = ["usual", "bestseller"] as const;

/**
 * Top-performer score weights. Both must be ≥ 0; passthrough is deliberately
 * absent so AI-handled closes never inflate human merit.
 *
 *   score = WEIGHT.replied * norm(replied_count)
 *         + WEIGHT.handled * norm(handled_count)
 */
export const SCORE_WEIGHTS = {
  replied: 0.5,
  handled: 0.5,
} as const;

/** First sync backfill window. */
export const BACKFILL_DAYS = 30;

/** Concurrency cap for per-ticket conversation fetches. */
export const FRESHDESK_CONCURRENCY = 5;

/** Page size for Freshdesk list endpoints. */
export const FRESHDESK_PAGE_SIZE = 100;

/**
 * Freshdesk caps the account at 100 requests per minute (a shared budget
 * with the AI bot using the same account). We reserve 40 req/min for the
 * bot by capping our sync at 60 req/min. This is a per-minute throughput
 * cap implemented via a token bucket — separate from FRESHDESK_CONCURRENCY,
 * which only governs how many requests run in parallel.
 */
export const FRESHDESK_TOKEN_RATE_PER_MIN = 60;

/**
 * Burst capacity of the token bucket. After an idle gap the bucket can
 * pre-fill up to this many tokens, letting a small flurry fire back-to-
 * back at full speed before the per-second drip pacing kicks in. Sustained
 * rate over any longer window is strictly FRESHDESK_TOKEN_RATE_PER_MIN.
 * Set to 1 for a strictly paced 1-request-per-second stream.
 */
export const FRESHDESK_TOKEN_BURST = 10;

/**
 * When Freshdesk's X-Ratelimit-Remaining drops below this, pause the whole
 * sync for the rest of the current minute window. Leaves headroom for the
 * AI bot if it's busy.
 */
export const FRESHDESK_LOW_REMAINING_THRESHOLD = 20;

/**
 * Auto-generated "needs attention" thresholds (per period per executive).
 * Edit to tune the tone of the summary callouts.
 */
export const ATTENTION_THRESHOLDS = {
  /** Replied / assigned below this → flag as low engagement. */
  lowRepliedRatio: 0.4,
  /** Passthrough / resolved above this → flag as high passthrough share. */
  highPassthroughShare: 0.6,
  /** Open backlog above this → flag as growing backlog. */
  highOpenBacklog: 10,
  /** Minimum assigned in the period to even evaluate the above. */
  minAssignedForFlags: 5,
} as const;

/**
 * Escalations watchlist + backlog thresholds. Mirrors the discipline of
 * the Freshdesk attention thresholds but for the reputation surface.
 *
 * Important: escalations are visibility data in this task — these
 * thresholds drive flagging, not scoring.
 */
export const ESCALATION_THRESHOLDS = {
  /** Public + unactioned beyond this many hours → reputation watchlist. */
  publicAgingHours: 24,
  /** Per-agent open + in-progress backlog above this → flag. */
  highOpenBacklog: 8,
} as const;
