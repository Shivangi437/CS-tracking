/**
 * Daily / weekly summary orchestrator.
 *
 *  1. Run a sync so numbers are fresh (the cron schedule runs this before
 *     each summary anyway, but doing it here makes the route robust to
 *     manual triggers).
 *  2. Compute the period report.
 *  3. Upsert a summaries row keyed on (type, period_start, period_end).
 *     - If the row didn't exist before: this is the first run; send
 *       notifications.
 *     - If it did exist: update the payload only — do NOT re-send so reruns
 *       are safe and don't spam.
 *  4. Send to email + Slack on first-time only (or when `force` is true).
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { summaries } from "@/lib/db/schema";
// runSync intentionally NOT imported — summary jobs no longer trigger
// Freshdesk traffic. See the comment in runSummary() for context.
import { getPeriodReport, type PeriodReport } from "@/lib/queries";
import { computeAttentionFlags, type AttentionFlag } from "@/lib/attention";
import { sendSummaryEmail } from "@/lib/email";
import { sendSummarySlack } from "@/lib/slack";
import { istToday, istWeekRange, istShiftDays } from "@/lib/dates";

export type SummaryType = "daily" | "weekly";

interface SummaryResult {
  type: SummaryType;
  periodStart: string;
  periodEnd: string;
  firstSend: boolean;
  email: { sent: boolean; skipped?: string; id?: string };
  slack: { sent: boolean; skipped?: string };
  totals: PeriodReport["totals"];
  topPerformer: { name: string; score: number } | null;
  attentionCount: number;
}

export interface RunSummaryOptions {
  type: SummaryType;
  /** If true, send notifications even when row already existed. */
  force?: boolean;
  /** Skip the pre-sync (handy for tests / manual reruns). */
  skipSync?: boolean;
}

export async function runSummary(opts: RunSummaryOptions): Promise<SummaryResult> {
  // Rate-limit fix (2026-06-12): summary jobs no longer pre-sync.
  //
  // Previously, the daily 18:00 IST summary AND the weekly Friday 18:00 IST
  // summary each kicked off their own runSync() before computing the
  // report. That meant 2–3 Freshdesk syncs per day on top of the
  // (then-every-30-min) cron — bursts during business hours that ate into
  // the shared 100 req/min account budget.
  //
  // The new contract: nothing other than the scheduled GitHub Actions
  // sync cron (02:00 IST) and the manual "Run sync" button can trigger
  // Freshdesk traffic. Summary jobs read whatever the 02:00 sync put in
  // the DB. opts.skipSync is now silently ignored — runSync is never
  // called from here, regardless of the flag.
  if (!opts.skipSync) {
    // Intentionally left blank — see comment above. Kept as a marked
    // dead branch so an audit grep shows the deliberate decision.
    // (Was: try { await runSync(); } catch { ... }.)
  }

  const { periodStart, periodEnd, periodLabel } = resolvePeriod(opts.type);
  const report = await getPeriodReport(periodStart, periodEnd);
  const attention = computeAttentionFlags(report.rows);

  const payload = buildPayload(report, attention);

  // INSERT ... ON CONFLICT DO UPDATE, and observe whether the existing row
  // actually changed to decide if this is a first-time write.
  const existing = await db
    .select({ id: summaries.id })
    .from(summaries)
    .where(
      sql`${summaries.type} = ${opts.type} AND ${summaries.periodStart} = ${periodStart}::date AND ${summaries.periodEnd} = ${periodEnd}::date`
    )
    .limit(1);

  const firstSend = existing.length === 0 || !!opts.force;

  await db
    .insert(summaries)
    .values({
      type: opts.type,
      periodStart,
      periodEnd,
      payload,
    })
    .onConflictDoUpdate({
      target: [summaries.type, summaries.periodStart, summaries.periodEnd],
      set: { payload: sql`excluded.payload` },
    });

  let email: SummaryResult["email"] = { sent: false, skipped: "not first run" };
  let slack: SummaryResult["slack"] = { sent: false, skipped: "not first run" };

  if (firstSend) {
    const subject = `${capitalize(opts.type)} CS summary · ${periodLabel}`;
    try {
      email = await sendSummaryEmail({
        subject,
        periodLabel,
        report,
        attention,
      });
    } catch (err) {
      email = {
        sent: false,
        skipped: err instanceof Error ? err.message : String(err),
      };
    }
    try {
      slack = await sendSummarySlack({ periodLabel, report, attention });
    } catch (err) {
      slack = {
        sent: false,
        skipped: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    type: opts.type,
    periodStart,
    periodEnd,
    firstSend,
    email,
    slack,
    totals: report.totals,
    topPerformer: report.topPerformer
      ? {
          name: report.topPerformer.name.split("||")[0].trim() ||
            report.topPerformer.name,
          score: Math.round(report.topPerformer.score * 100),
        }
      : null,
    attentionCount: attention.length,
  };
}

function resolvePeriod(type: SummaryType): {
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
} {
  const today = istToday();
  if (type === "daily") {
    return {
      periodStart: today,
      periodEnd: today,
      periodLabel: today,
    };
  }
  // Weekly = last 7 IST days ending today (per spec: "Mon-Fri (or last 7 days)")
  const start = istShiftDays(today, -6);
  return {
    periodStart: start,
    periodEnd: today,
    periodLabel: `Week ending ${today}`,
  };
}

function buildPayload(report: PeriodReport, attention: AttentionFlag[]) {
  return {
    totals: report.totals,
    topPerformer: report.topPerformer
      ? {
          name: report.topPerformer.name.split("||")[0].trim() ||
            report.topPerformer.name,
          agentId: report.topPerformer.agentId,
          replied: report.topPerformer.replied,
          handled: report.topPerformer.handled,
          score: report.topPerformer.score,
        }
      : null,
    rows: report.rows.map((r) => ({
      agentId: r.agentId,
      name: r.name.split("||")[0].trim() || r.name,
      assigned: r.assigned,
      replied: r.replied,
      resolved: r.resolved,
      handled: r.handled,
      passthrough: r.passthrough,
      open: r.open,
      score: r.score,
    })),
    attention,
  };
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

// Re-export for use by the weekly route.
export { istWeekRange };
