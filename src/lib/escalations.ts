/**
 * Shared escalation derivation rules.
 *
 * Both the CSV import script and the new-escalation server action call into
 * these — never trust the client (or the CSV) for `credit_class`,
 * `escalation_type`, `needs_attention`, or `is_public`. They're computed
 * here from the inputs the user/CSV controlled so the merit-vs-visibility
 * discipline stays enforced in one place.
 */

export type Channel =
  | "LinkedIn"
  | "Instagram"
  | "Quora"
  | "Trustpilot"
  | "MouthShut"
  | "Google"
  | "Email"
  | "Helpdesk";

export type Medium =
  | "post"
  | "comment"
  | "reel"
  | "story"
  | "dm"
  | "email";

export type Status =
  | "resolved"
  | "in_progress"
  | "open_unactioned"
  | "unlogged"
  | "author_unresponsive"
  | "author_declined";

export type CreditClass = "merit" | "visibility";

export type EscalationType = "individual" | "pileon_comment";

export const CHANNELS: Channel[] = [
  "LinkedIn",
  "Instagram",
  "Quora",
  "Trustpilot",
  "MouthShut",
  "Google",
  "Email",
  "Helpdesk",
];

export const MEDIA: Medium[] = ["post", "comment", "reel", "story", "dm", "email"];

export const STATUSES: Status[] = [
  "resolved",
  "in_progress",
  "open_unactioned",
  "unlogged",
  "author_unresponsive",
  "author_declined",
];

export const CATEGORIES = [
  "author_copies_delivery",
  "publication_delay",
  "listing_error",
  "royalties_reporting",
  "refund_request",
  "delisting",
  "quality_defect",
  "award_certificate",
  "no_human_comms",
  "reputation_pileon",
  "other",
] as const;

/** Public-facing reputation surfaces. */
const PUBLIC_CHANNELS = new Set<Channel>(["Quora", "Trustpilot", "MouthShut", "Google"]);
const PUBLIC_MEDIA = new Set<Medium>(["post", "comment", "reel", "story"]);

/** Status set that, combined with individual escalationType, earns merit. */
const MERIT_STATUSES = new Set<Status>(["resolved", "in_progress"]);

/** Status set that flags a row as needing attention. */
const NEEDS_ATTENTION_STATUSES = new Set<Status>(["open_unactioned", "unlogged"]);

/**
 * Short-echo pile-on phrases. A comment that's just one of these (alone or
 * within a few words) is a viral-thread pile-on, not an individual case.
 * The full text is compared lowercased and stripped of punctuation.
 */
const PILEON_PATTERNS: RegExp[] = [
  /\bsame here\b/i,
  /\bsame boat\b/i,
  /\bsame issue\b/i,
  /\bsame problem\b/i,
  /\bsimilar experience\b/i,
  /\bsimilar issue\b/i,
  /\bme too\b/i,
  /\bme also\b/i,
  /\bsame thing happened\b/i,
  /\bfacing (the )?same\b/i,
  /\b\+\s*1\b/i, // "+1"
];

export function isPileonComment(medium: string | null, issueText: string | null): boolean {
  if (medium !== "comment") return false;
  if (!issueText) return false;
  const text = issueText.trim();
  // Short comments only — anything beyond a brief echo is treated as a real case.
  if (text.length > 80) return false;
  return PILEON_PATTERNS.some((re) => re.test(text));
}

export function derivePublic(
  channel: string,
  medium: string | null
): boolean {
  if (PUBLIC_CHANNELS.has(channel as Channel)) return true;
  if (medium && PUBLIC_MEDIA.has(medium as Medium)) return true;
  return false;
}

export function deriveEscalationType(
  medium: string | null,
  issueText: string | null
): EscalationType {
  return isPileonComment(medium, issueText) ? "pileon_comment" : "individual";
}

export function deriveCreditClass(
  status: string,
  escalationType: EscalationType
): CreditClass {
  if (escalationType !== "individual") return "visibility";
  return MERIT_STATUSES.has(status as Status) ? "merit" : "visibility";
}

export function deriveNeedsAttention(status: string): boolean {
  return NEEDS_ATTENTION_STATUSES.has(status as Status);
}

/** Lowercase + trim + collapse whitespace. */
export function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

export interface EscalationDerived {
  isPublic: boolean;
  escalationType: EscalationType;
  creditClass: CreditClass;
  needsAttention: boolean;
}

/**
 * Single entry-point: given the user-controlled inputs, return the server-
 * derived flags. The import script and the create-escalation action both
 * call this so the rules can't drift.
 */
export function deriveAll(input: {
  channel: string;
  medium: string | null;
  issueText: string | null;
  status: string;
}): EscalationDerived {
  const escalationType = deriveEscalationType(input.medium, input.issueText);
  return {
    isPublic: derivePublic(input.channel, input.medium),
    escalationType,
    creditClass: deriveCreditClass(input.status, escalationType),
    needsAttention: deriveNeedsAttention(input.status),
  };
}
