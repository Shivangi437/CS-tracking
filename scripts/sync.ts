/**
 * Run a sync from the CLI, bypassing HTTP. Use for the initial 30-day
 * backfill — it can take >10 min, which is longer than any reasonable HTTP
 * request timeout. Once the first sync succeeds, the regular cron-driven
 * /api/cron/sync handles incremental ~30-min windows comfortably.
 *
 *   npx tsx scripts/sync.ts
 */

import { runSync } from "@/lib/sync";

async function main() {
  const t0 = Date.now();
  console.log("[sync] starting");
  const result = await runSync();
  console.log(JSON.stringify(result, null, 2));
  console.log(`[sync] done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((err) => {
  console.error("[sync] failed:", err);
  process.exit(1);
});
