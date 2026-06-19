-- Add Freshdesk Product id to tickets so we can split the backlog by portal.
--
-- product_id IS NULL  → the "None" product = the usual support portal
-- product_id NOT NULL → the "bestseller" product = the premium portal
--
-- The value already rides along in the ticket payload the sync fetches, so
-- populating it going forward costs zero extra Freshdesk API calls. Existing
-- rows stay NULL until they're next synced (or backfilled via the optional
-- scripts/backfill-product-id.ts pass).

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "product_id" bigint;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_product_id_idx" ON "tickets" ("product_id");
