/**
 * One-shot helper to recompute agent_daily_stats for the last 30 IST days
 * against whatever's currently in the DB. Useful while a long backfill is
 * still in progress so the dashboard shows real numbers immediately.
 *
 *   node --env-file=.env.local --import tsx scripts/recompute-last-30.ts
 */

import { recomputeRollups } from "@/lib/rollups";
import { istToday, istShiftDays } from "@/lib/dates";

async function main() {
  const today = istToday();
  const dates: string[] = [];
  for (let i = 0; i < 30; i++) dates.push(istShiftDays(today, -i));
  console.log(`[recompute] running for ${dates.length} IST dates: ${dates[dates.length - 1]} → ${dates[0]}`);
  const t0 = Date.now();
  await recomputeRollups(dates);
  console.log(`[recompute] done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
