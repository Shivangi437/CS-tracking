"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads server components from Postgres/Neon at an interval.
 *
 * Was previously a sync trigger that called the triggerSyncAction server
 * action (which ran a real Freshdesk sync) on every dashboard tab open.
 * That caused unbounded, unpredictable Freshdesk traffic: every teammate
 * with a tab open was effectively driving the sync, and the bursts ate
 * the account's 100 req/min budget shared with the AI bot.
 *
 * As of the rate-limit fix this component:
 *   - NEVER calls Freshdesk.
 *   - NEVER triggers runSync.
 *   - ONLY calls router.refresh() — which re-fetches the server-rendered
 *     components, which re-read from Postgres/Neon. Zero outbound traffic
 *     to Freshdesk.
 *
 * Sync now happens on exactly two triggers:
 *   1. The scheduled GitHub Actions cron (daily 02:00 IST).
 *   2. The manual "Run sync" button (explicit human-initiated action).
 *
 * The dashboard's "Last synced" badge updates because router.refresh()
 * re-reads the sync_log table — when the cron lands a new success, the
 * badge advances on the next 60s tick without anyone clicking anything.
 *
 * `lastSyncedAt` is accepted as a prop for API stability with the
 * existing layout but is no longer used internally.
 */
export function AutoSync({
  pollMs = 60_000,
  lastSyncedAt: _lastSyncedAt,
}: {
  pollMs?: number;
  lastSyncedAt?: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      try {
        router.refresh();
      } catch {
        // Silent — a transient router.refresh() failure shouldn't break the UI.
      }
    };
    const id = setInterval(tick, pollMs);
    return () => clearInterval(id);
  }, [router, pollMs]);

  return null;
}
