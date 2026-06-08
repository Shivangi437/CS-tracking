import { env } from "@/lib/env";
import type { PeriodReport } from "@/lib/queries";
import type { AttentionFlag } from "@/lib/attention";

interface SendArgs {
  periodLabel: string;
  report: PeriodReport;
  attention: AttentionFlag[];
}

export async function sendSummarySlack(args: SendArgs): Promise<{
  sent: boolean;
  skipped?: string;
}> {
  const webhook = env.SLACK_WEBHOOK_URL;
  if (!webhook) return { sent: false, skipped: "SLACK_WEBHOOK_URL not set" };

  const body = JSON.stringify(renderBlocks(args));
  const r = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Slack webhook ${r.status}: ${text.slice(0, 200)}`);
  }
  return { sent: true };
}

function renderBlocks({ periodLabel, report, attention }: SendArgs) {
  const t = report.totals;
  const top = report.topPerformer;
  const cleanName = (n: string) => n.split("||")[0].trim() || n;

  const totalsLine = `*Assigned* ${t.assigned}  ·  *Replied* ${t.replied}  ·  *Resolved* ${t.resolved} (${t.handled} handled / ${t.passthrough} passthrough)  ·  *Open* ${t.open}`;

  // Per-exec lines — bold the top performer, monospace align in a code block.
  const colW = { name: 18, asn: 4, rep: 4, res: 4, hnd: 4, pst: 4, score: 5 };
  const header = `${pad("Executive", colW.name)} ${pad("Asn", colW.asn, true)} ${pad("Rep", colW.rep, true)} ${pad("Res", colW.res, true)} ${pad("Hnd", colW.hnd, true)} ${pad("Pst", colW.pst, true)} ${pad("Score", colW.score, true)}`;
  const rule = "─".repeat(header.length);
  const lines = report.rows.map((r) => {
    return `${pad(cleanName(r.name), colW.name)} ${pad(r.assigned, colW.asn, true)} ${pad(r.replied, colW.rep, true)} ${pad(r.resolved, colW.res, true)} ${pad(r.handled, colW.hnd, true)} ${pad(r.passthrough, colW.pst, true)} ${pad(Math.round(r.score * 100), colW.score, true)}`;
  });
  const table = ["```", header, rule, ...lines, "```"].join("\n");

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `CS Performance · ${periodLabel}` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${report.start}${report.end !== report.start ? ` → ${report.end}` : ""} (IST)`,
        },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: totalsLine } },
  ];

  if (top) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🏆 *Top performer · ${periodLabel}* — *${cleanName(
          top.name
        )}*  ·  Replied ${top.replied} · Handled ${top.handled} · Score ${Math.round(
          top.score * 100
        )}`,
      },
    });
  }

  blocks.push({ type: "section", text: { type: "mrkdwn", text: table } });

  if (attention.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Needs attention*\n` +
          attention.map((a) => `• ${a.message}`).join("\n"),
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "_Handled = exec replied + closed · Passthrough = AI replied, exec closed only · Score excludes passthrough._",
      },
    ],
  });

  return { blocks };
}

function pad(v: string | number, width: number, right = false): string {
  const s = String(v);
  if (s.length >= width) return s.slice(0, width);
  const fill = " ".repeat(width - s.length);
  return right ? `${fill}${s}` : `${s}${fill}`;
}
