import { sql } from "drizzle-orm";
import {
  pgTable,
  bigint,
  text,
  integer,
  boolean,
  timestamp,
  date,
  real,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  serial,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const agents = pgTable("agents", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  /** True for the Freshdesk AI auto-replier(s). Excluded from human metrics. */
  isAi: boolean("is_ai").notNull().default(false),
  active: boolean("active").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

export const tickets = pgTable(
  "tickets",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    subject: text("subject"),
    /** Freshdesk numeric status: 2=Open, 3=Pending, 4=Resolved, 5=Closed. */
    status: integer("status"),
    priority: integer("priority"),
    responderId: bigint("responder_id", { mode: "number" }),
    groupId: bigint("group_id", { mode: "number" }),
    /**
     * Freshdesk Product id. Null = the "None" product = the *usual* support
     * portal; non-null = the "bestseller" product. Already present in the
     * ticket payload the sync fetches, so capturing it costs no extra API calls.
     */
    productId: bigint("product_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    firstRespondedAt: timestamp("first_responded_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    /** 'handled' = resolved with ≥1 human reply by responder; 'passthrough' = no human reply. */
    resolutionClass: text("resolution_class"),
    spam: boolean("spam").notNull().default(false),
    deleted: boolean("deleted").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tickets_responder_idx").on(t.responderId),
    index("tickets_resolved_at_idx").on(t.resolvedAt),
    index("tickets_updated_at_idx").on(t.updatedAt),
    index("tickets_product_id_idx").on(t.productId),
  ]
);

export const ticketReplies = pgTable(
  "ticket_replies",
  {
    id: serial("id").primaryKey(),
    ticketId: bigint("ticket_id", { mode: "number" }).notNull(),
    conversationId: bigint("conversation_id", { mode: "number" }).notNull(),
    agentId: bigint("agent_id", { mode: "number" }),
    /** True when this reply was posted by an AI agent (see agents.is_ai). */
    isAi: boolean("is_ai").notNull().default(false),
    isPublic: boolean("is_public").notNull().default(true),
    repliedAt: timestamp("replied_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("ticket_replies_unique").on(t.ticketId, t.conversationId),
    index("ticket_replies_agent_replied_idx").on(t.agentId, t.repliedAt),
    index("ticket_replies_ticket_idx").on(t.ticketId),
  ]
);

export const agentDailyStats = pgTable(
  "agent_daily_stats",
  {
    date: date("date").notNull(),
    agentId: bigint("agent_id", { mode: "number" }).notNull(),
    /** Distinct tickets currently assigned to the exec that entered the period. */
    assignedCount: integer("assigned_count").notNull().default(0),
    /** Distinct tickets the human exec posted ≥1 public reply on, in-period. */
    repliedCount: integer("replied_count").notNull().default(0),
    /** Tickets with resolved_at in-period, credited to responder_id. */
    resolvedCount: integer("resolved_count").notNull().default(0),
    /** Resolved AND human exec had ≥1 reply on the ticket. Merit. */
    handledCount: integer("handled_count").notNull().default(0),
    /** Resolved with no human reply (AI handled, exec just closed). Visibility only. */
    passthroughCount: integer("passthrough_count").notNull().default(0),
    /** Currently assigned to exec and not resolved (snapshot at sync time). */
    openCount: integer("open_count").notNull().default(0),
    score: real("score").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.agentId] }),
    index("agent_daily_stats_date_idx").on(t.date),
  ]
);

export const summaries = pgTable(
  "summaries",
  {
    id: serial("id").primaryKey(),
    /** 'daily' | 'weekly' */
    type: text("type").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("summaries_type_period_idx").on(
      t.type,
      t.periodStart,
      t.periodEnd
    ),
  ]
);

/**
 * Escalations: work that arrives *outside* Freshdesk — LinkedIn, Instagram,
 * Quora, Trustpilot, MouthShut, Google reviews, personal email. Surfaces
 * load that's currently invisible. Per spec: never folds into the Score in
 * this task; lives alongside the Freshdesk numbers as visibility data.
 *
 * Merit-vs-visibility discipline mirrors the Freshdesk handled/passthrough
 * split: a `creditClass='merit'` row counts as real resolution work,
 * `'visibility'` is touches-only.
 *
 * `parentId` groups pile-on comments under their source post so a viral
 * thread doesn't inflate any one agent's numbers.
 */
export const escalations = pgTable(
  "escalations",
  {
    id: serial("id").primaryKey(),
    openedAt: date("opened_at"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** LinkedIn|Instagram|Quora|Trustpilot|MouthShut|Google|Email|Helpdesk */
    channel: text("channel").notNull(),
    /** post|comment|reel|story|dm|email */
    medium: text("medium"),
    /** Reputation-facing surface (Quora/Trustpilot/post/comment) vs private (dm/email). */
    isPublic: boolean("is_public").notNull().default(false),
    authorName: text("author_name"),
    /** Join key back to Freshdesk requester. Always stored lowercased + trimmed. */
    authorEmail: text("author_email"),
    authorEmailAlt: text("author_email_alt"),
    /** Social handle when there's no email. */
    handle: text("handle"),
    /** Bridge to the main tracker. */
    freshdeskTicket: text("freshdesk_ticket"),
    issueText: text("issue_text"),
    /**
     * author_copies_delivery|publication_delay|listing_error|royalties_reporting
     * |refund_request|delisting|quality_defect|award_certificate|no_human_comms
     * |reputation_pileon|other
     */
    category: text("category"),
    /**
     * resolved|in_progress|open_unactioned|unlogged|author_unresponsive
     * |author_declined
     */
    status: text("status").notNull().default("unlogged"),
    /** merit|visibility — derived server-side from status + escalationType. */
    creditClass: text("credit_class").notNull().default("visibility"),
    /** individual|pileon_comment */
    escalationType: text("escalation_type").notNull().default("individual"),
    /** Groups pile-on comments under their source post. */
    parentId: integer("parent_id").references((): AnyPgColumn => escalations.id),
    legalThreat: boolean("legal_threat").notNull().default(false),
    needsAttention: boolean("needs_attention").notNull().default(false),
    closureConfirmed: boolean("closure_confirmed").notNull().default(false),
    /** Goodwill given away: PR Article|Author Copies|Award|... */
    remediation: text("remediation"),
    /** Credited executive (display name; freeform for manual entry). */
    agent: text("agent"),
    /** Manager sign-off (Rama) — guards against self-inflated logs. */
    verifiedBy: text("verified_by"),
    notes: text("notes"),
    /**
     * Tooling column for idempotent CSV import. SHA-256 of the canonical
     * source row; unique so re-running the importer never duplicates.
     * Null for manually-entered rows.
     */
    importHash: text("import_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // TODO: future Freshdesk-mailbox routing plug-in lands here — once the
    // email channel feeds into Freshdesk we can drop a freshdesk_conversation_id
    // foreign key and stop logging email escalations by hand.
  },
  (t) => [
    index("escalations_author_email_idx").on(t.authorEmail),
    index("escalations_agent_idx").on(t.agent),
    index("escalations_opened_at_idx").on(t.openedAt),
    // Partial index: only rows actually surfacing publicly. Watchlist hits this.
    index("escalations_public_open_idx")
      .on(t.openedAt)
      .where(sql`is_public = true`),
    index("escalations_freshdesk_ticket_idx").on(t.freshdeskTicket),
    uniqueIndex("escalations_import_hash_idx").on(t.importHash),
  ]
);

/**
 * Manually-curated roster of people who can be credited on escalations
 * and who can edit them. Separate from the `agents` table — which is
 * auto-synced from Freshdesk and includes the AI bot + people not on
 * the current CS roster. This table is hand-managed via /admin/team
 * and feeds the "Editing as" audit dropdown + the Slack DM target
 * lookup (slack_member_id).
 *
 * Intentionally narrow shape (name, slack_member_id, active) so it
 * stays a roster, not a profile store.
 */
/**
 * Per-field audit trail for every escalation update. One row per changed
 * field per save. Credit disputes need a paper trail — not Slack
 * scrollback — and this is non-negotiable per the spec.
 *
 * edited_by is plain text (the name the user picked in the "Editing as"
 * dropdown) so removing a team_members row never breaks history.
 */
export const escalationEdits = pgTable(
  "escalation_edits",
  {
    id: serial("id").primaryKey(),
    escalationId: integer("escalation_id").notNull(),
    editedBy: text("edited_by").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
  },
  (t) => [
    index("escalation_edits_escalation_id_idx").on(
      t.escalationId,
      t.editedAt
    ),
  ]
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /** Slack U... id used for direct messages. Manually entered. */
    slackMemberId: text("slack_member_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Case-insensitive unique index — applied via the SQL migration
  // 0005_case_insensitive_team_member_names.sql. Drizzle Kit doesn't
  // model functional indexes well, so the .on(t.name) here is a
  // placeholder that matches what the migration created; the actual
  // CREATE INDEX statement uses LOWER(name). Do not regenerate.
  (t) => [uniqueIndex("team_members_name_idx").on(t.name)]
);

export const syncLog = pgTable(
  "sync_log",
  {
    id: serial("id").primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ticketsSynced: integer("tickets_synced").notNull().default(0),
    /** 'running' | 'success' | 'failure' */
    status: text("status").notNull(),
    error: text("error"),
    /** updated_since watermark for the next incremental sync. */
    watermark: timestamp("watermark", { withTimezone: true }),
  },
  (t) => [
    /**
     * Global single-flight guarantee at the database level. At most ONE
     * row may have status='running' at any moment, anywhere — across all
     * Vercel function instances, CLI invocations, and concurrent triggers.
     *
     * Without this, each Vercel cold-start gets its own fresh in-memory
     * token bucket and several instances run in parallel, each rate-paced
     * at 60/min but collectively blowing past Freshdesk's 100/min ceiling
     * and stealing budget from the AI bot. Postgres rejects a second
     * INSERT here with a 23505 unique_violation; runSync catches that and
     * treats it as SyncBusyError (the workflow already handles that as a
     * success skip).
     */
    uniqueIndex("sync_log_only_one_running_idx")
      .on(t.status)
      .where(sql`status = 'running'`),
  ]
);
