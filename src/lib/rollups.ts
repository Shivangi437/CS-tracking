/**
 * Daily rollup recompute. Stub in M2 — fully implemented in M3.
 *
 * Given a set of affected IST dates (yyyy-MM-dd), recomputes every
 * `agent_daily_stats` row that touches those dates, and stamps each
 * resolved ticket's `resolution_class` as 'handled' or 'passthrough'.
 */

export async function recomputeRollups(istDates: string[]): Promise<void> {
  if (istDates.length === 0) return;
  // M3 fills in: walk tickets/replies/agents for these dates, compute counts,
  // upsert agent_daily_stats, normalise scores, write tickets.resolution_class.
  void istDates;
}
