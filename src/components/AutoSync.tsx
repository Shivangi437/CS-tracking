"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { triggerSyncAction } from "@/lib/actions";

/**
 * Silently keeps the dashboard fresh.
 *
 * - On mount: if the last sync is older than `staleAfterMs`, triggers a sync
 *   and soft-refreshes the page so server components re-fetch from the DB.
 * - While the page stays open: re-checks every `pollMs`.
 *
 * Throttled by `staleAfterMs` so opening the page 5 times in a minute doesn't
 * fire 5 syncs. An in-flight guard prevents overlapping triggers if a sync is
 * already running.
 */
export function AutoSync({
  lastSyncedAt,
  staleAfterMs = 90_000,
  pollMs = 60_000,
}: {
  lastSyncedAt: string | null;
  staleAfterMs?: number;
  pollMs?: number;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const lastSyncRef = useRef<number | null>(
    lastSyncedAt ? new Date(lastSyncedAt).getTime() : null
  );

  useEffect(() => {
    const tryRefresh = async () => {
      if (inFlight.current) return;
      const last = lastSyncRef.current;
      const stale = last == null || Date.now() - last > staleAfterMs;
      if (!stale) return;
      inFlight.current = true;
      try {
        const r = await triggerSyncAction();
        if (r.ok) {
          lastSyncRef.current = Date.now();
          router.refresh();
        }
      } catch {
        // Swallow — silent background refresh shouldn't trip a UI error.
      } finally {
        inFlight.current = false;
      }
    };
    void tryRefresh();
    const id = setInterval(tryRefresh, pollMs);
    return () => clearInterval(id);
  }, [router, staleAfterMs, pollMs]);

  return null;
}
