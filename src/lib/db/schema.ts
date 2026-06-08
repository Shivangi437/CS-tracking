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

export const syncLog = pgTable("sync_log", {
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
});
