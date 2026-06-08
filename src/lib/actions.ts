"use server";

import { revalidatePath } from "next/cache";
import { runSync } from "@/lib/sync";

/**
 * Server-action-form of the sync endpoint. The "Run sync" button on the
 * dashboard calls this directly — no bearer token needed because the
 * action only runs inside the authenticated session (M7 middleware).
 */
export async function triggerSyncAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const r = await runSync();
    revalidatePath("/today");
    revalidatePath("/week");
    revalidatePath("/summaries");
    return {
      ok: true,
      message: `Synced ${r.ticketsSynced} ticket${
        r.ticketsSynced === 1 ? "" : "s"
      } · ${r.repliesUpserted} replies · ${r.affectedDates.length} day(s) recomputed`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
