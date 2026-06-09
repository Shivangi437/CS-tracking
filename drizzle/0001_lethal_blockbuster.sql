CREATE TABLE "escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"opened_at" date,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"channel" text NOT NULL,
	"medium" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"author_name" text,
	"author_email" text,
	"author_email_alt" text,
	"handle" text,
	"freshdesk_ticket" text,
	"issue_text" text,
	"category" text,
	"status" text DEFAULT 'unlogged' NOT NULL,
	"credit_class" text DEFAULT 'visibility' NOT NULL,
	"escalation_type" text DEFAULT 'individual' NOT NULL,
	"parent_id" integer,
	"legal_threat" boolean DEFAULT false NOT NULL,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"closure_confirmed" boolean DEFAULT false NOT NULL,
	"remediation" text,
	"agent" text,
	"verified_by" text,
	"notes" text,
	"import_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_parent_id_escalations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."escalations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escalations_author_email_idx" ON "escalations" USING btree ("author_email");--> statement-breakpoint
CREATE INDEX "escalations_agent_idx" ON "escalations" USING btree ("agent");--> statement-breakpoint
CREATE INDEX "escalations_opened_at_idx" ON "escalations" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "escalations_public_open_idx" ON "escalations" USING btree ("opened_at") WHERE is_public = true;--> statement-breakpoint
CREATE INDEX "escalations_freshdesk_ticket_idx" ON "escalations" USING btree ("freshdesk_ticket");--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_import_hash_idx" ON "escalations" USING btree ("import_hash");