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
import { runSync } from "@/lib/sync";
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
  if (!opts.skipSync) {
    try {
      await runSync();
    } catch (err) {
      console.error(
        "[summary] pre-sync failed; proceeding with existing data:",
        err instanceof Error ? err.message : err
      );
    }
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
