/**
 * Auto-generated "needs attention" lines for the daily/weekly summary.
 * Reads thresholds from config.ts so tone can be tuned without redeploying
 * logic.
 */

import type { LeaderboardRow } from "@/lib/queries";
import { ATTENTION_THRESHOLDS } from "@/lib/config";

export interface AttentionFlag {
  agentId: number;
  name: string;
  kind: "low_replied_ratio" | "high_passthrough_share" | "growing_backlog";
  message: string;
}

const cleanName = (n: string) => n.split("||")[0].trim() || n;

export function computeAttentionFlags(
  rows: LeaderboardRow[]
): AttentionFlag[] {
  const out: AttentionFlag[] = [];

  for (const r of rows) {
    const name = cleanName(r.name);

    // Low replied-to-assigned ratio
    if (r.assigned >= ATTENTION_THRESHOLDS.minAssignedForFlags) {
      const ratio = r.replied / r.assigned;
      if (ratio < ATTENTION_THRESHOLDS.lowRepliedRatio) {
        out.push({
          agentId: r.agentId,
          name,
          kind: "low_replied_ratio",
          message: `${name} replied to only ${r.replied}/${r.assigned} (${Math.round(
            ratio * 100
          )}%) of tickets assigned in this period.`,
        });
      }
    }

    // High passthrough share of closes
    if (r.resolved >= ATTENTION_THRESHOLDS.minAssignedForFlags) {
      const share = r.passthrough / r.resolved;
      if (share > ATTENTION_THRESHOLDS.highPassthroughShare) {
        out.push({
          agentId: r.agentId,
          name,
          kind: "high_passthrough_share",
          message: `${name} closed ${r.resolved} tickets but only handled ${r.handled} (${Math.round(
            share * 100
          )}% were AI passthroughs).`,
        });
      }
    }

    // Open backlog above threshold
    if (r.open > ATTENTION_THRESHOLDS.highOpenBacklog) {
      out.push({
        agentId: r.agentId,
        name,
        kind: "growing_backlog",
        message: `${name} has ${r.open} open tickets in their queue.`,
      });
    }
  }

  return out;
}
