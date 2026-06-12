CREATE TABLE "escalation_edits" (
	"id" serial PRIMARY KEY NOT NULL,
	"escalation_id" integer NOT NULL,
	"edited_by" text NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"field_name" text NOT NULL,
	"old_value" text,
	"new_value" text
);
--> statement-breakpoint
CREATE INDEX "escalation_edits_escalation_id_idx" ON "escalation_edits" USING btree ("escalation_id","edited_at");