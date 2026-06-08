/**
 * Placeholder for M1. Real Today view (team totals, leaderboard, top performer)
 * lands in M4 once sync + rollups exist.
 */
export default function TodayPage() {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 text-center">
      <h1 className="text-lg font-semibold">CS Performance Tracker</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Scaffolding in place. Sync, rollups, and the leaderboard are coming in
        the next milestones.
      </p>
      <p className="mt-4 font-mono text-xs text-[var(--subtle)]">
        M1 ✓ scaffold · M2 sync · M3 rollups · M4 leaderboard · M5 week +
        detail · M6 summaries · M7 auth + cron
      </p>
    </div>
  );
}
