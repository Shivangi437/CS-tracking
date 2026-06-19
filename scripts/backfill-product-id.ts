/**
 * One-time backfill of tickets.product_id for the CURRENT open backlog.
 *
 * Why: the product_id column is captured for free on every sync going
 * forward, but pre-existing rows are NULL until they're next touched —
 * which would temporarily mislabel old bestseller tickets as "usual". This
 * pass fixes the current snapshot so the /backlog view is correct on day one.
 *
 * Scope + safety:
 *   - Only fetches tickets that are still unresolved in our DB
 *     (status NOT IN 4=Resolved, 5=Closed) — a small, bounded set.
 *   - Every fetch goes through the shared Freshdesk rate limiter, which
 *     reserves headroom for the AI bot. It CANNOT exceed the bot-safe
 *     budget; worst case it just runs a few minutes longer.
 *   - Idempotent: re-running it only re-confirms the same values.
 *
 *   node --env-file=.env.local --import tsx scripts/backfill-product-id.ts
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";
import { fetchTicket, FreshdeskHttpError } from "@/lib/freshdesk";

async function main() {
  const t0 = Date.now();

  const open = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(sql`${tickets.status} NOT IN (4, 5) AND NOT spam AND NOT deleted`);

  console.log(`[backfill] ${open.length} unresolved tickets to label`);

  let updated = 0;
  let missing = 0;
  for (const [i, row] of open.entries()) {
    try {
      const t = await fetchTicket(row.id);
      await db
        .update(tickets)
        .set({ productId: t.product_id ?? null })
        .where(sql`${tickets.id} = ${row.id}`);
      updated++;
    } catch (err) {
      // A 404 just means the ticket was deleted/merged on Freshdesk's side
      // since our last sync — skip it, don't abort the whole run.
      if (err instanceof FreshdeskHttpError && err.status === 404) {
        missing++;
      } else {
        throw err;
      }
    }
    if ((i + 1) % 25 === 0) {
      console.log(`[backfill] ${i + 1}/${open.length}…`);
    }
  }

  console.log(
    `[backfill] done in ${Math.round(
      (Date.now() - t0) / 1000
    )}s — ${updated} labeled, ${missing} gone (404).`
  );
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
