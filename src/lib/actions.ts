"use server";

import { revalidatePath } from "next/cache";
import { runSync, SyncBusyError } from "@/lib/sync";

/**
 * Server-action-form of the sync endpoint. The "Run sync" button on the
 * dashboard calls this directly. SyncBusyError (another sync already
 * running) is treated as a successful no-op — the caller gets a friendly
 * message instead of an error.
 */
export async function triggerSyncAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const r = await runSync();
    revalidatePath("/today");
    revalidatePath("/week");
    revalidatePath("/month");
    revalidatePath("/summaries");
    return {
      ok: true,
      message: `Synced ${r.ticketsSynced} ticket${
        r.ticketsSynced === 1 ? "" : "s"
      } · ${r.repliesUpserted} replies · ${r.affectedDates.length} day(s) recomputed`,
    };
  } catch (err) {
    if (err instanceof SyncBusyError) {
      // Single-flight: another tab is already syncing. Soft no-op.
      return { ok: true, message: err.message };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
