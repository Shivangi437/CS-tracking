/**
 * Single source of truth for tunable constants. Edit weights here to retune
 * the leaderboard without touching logic.
 */

export const TIMEZONE = "Asia/Kolkata";

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
