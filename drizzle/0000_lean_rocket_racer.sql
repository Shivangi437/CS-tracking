CREATE TABLE "agent_daily_stats" (
	"date" date NOT NULL,
	"agent_id" bigint NOT NULL,
	"assigned_count" integer DEFAULT 0 NOT NULL,
	"replied_count" integer DEFAULT 0 NOT NULL,
	"resolved_count" integer DEFAULT 0 NOT NULL,
	"handled_count" integer DEFAULT 0 NOT NULL,
	"passthrough_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_daily_stats_date_agent_id_pk" PRIMARY KEY("date","agent_id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"is_ai" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"tickets_synced" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"watermark" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" bigint NOT NULL,
	"conversation_id" bigint NOT NULL,
	"agent_id" bigint,
	"is_ai" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"replied_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" bigint PRIMARY KEY NOT NULL,
	"subject" text,
	"status" integer,
	"priority" integer,
	"responder_id" bigint,
	"group_id" bigint,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"resolution_class" text,
	"spam" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_daily_stats_date_idx" ON "agent_daily_stats" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "summaries_type_period_idx" ON "summaries" USING btree ("type","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_replies_unique" ON "ticket_replies" USING btree ("ticket_id","conversation_id");--> statement-breakpoint
CREATE INDEX "ticket_replies_agent_replied_idx" ON "ticket_replies" USING btree ("agent_id","replied_at");--> statement-breakpoint
CREATE INDEX "ticket_replies_ticket_idx" ON "ticket_replies" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_responder_idx" ON "tickets" USING btree ("responder_id");--> statement-breakpoint
CREATE INDEX "tickets_resolved_at_idx" ON "tickets" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "tickets_updated_at_idx" ON "tickets" USING btree ("updated_at");