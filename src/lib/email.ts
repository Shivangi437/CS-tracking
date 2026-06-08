import { Resend } from "resend";
import { env } from "@/lib/env";
import type { PeriodReport } from "@/lib/queries";
import type { AttentionFlag } from "@/lib/attention";

interface SendArgs {
  subject: string;
  periodLabel: string;
  report: PeriodReport;
  attention: AttentionFlag[];
}

export async function sendSummaryEmail(args: SendArgs): Promise<{
  sent: boolean;
  skipped?: string;
  id?: string;
}> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.SUMMARY_EMAIL_FROM;
  const to = env.SUMMARY_EMAIL_TO;

  if (!apiKey) return { sent: false, skipped: "RESEND_API_KEY not set" };
  if (!from) return { sent: false, skipped: "SUMMARY_EMAIL_FROM not set" };
  if (to.length === 0)
    return { sent: false, skipped: "SUMMARY_EMAIL_TO not set" };

  const resend = new Resend(apiKey);
  const html = renderHtml(args);

  const r = await resend.emails.send({
    from,
    to,
    subject: args.subject,
    html,
  });

  if (r.error) throw new Error(`Resend error: ${r.error.message}`);
  return { sent: true, id: r.data?.id };
}

function renderHtml({ periodLabel, report, attention }: SendArgs): string {
  const t = report.totals;
  const top = report.topPerformer;
  const cleanName = (n: string) => n.split("||")[0].trim() || n;

  const rowsHtml = report.rows
    .map((r, i) => {
      const isTop = top && r.agentId === top.agentId;
      const style = isTop
        ? "background:#fef3c7;font-weight:600"
        : i % 2 === 0
        ? "background:#ffffff"
        : "background:#f9fafb";
      return `
        <tr style="${style}">
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb">${i + 1}</td>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb">${cleanName(r.name)}${
        isTop ? ' <span style="color:#b45309">🏆</span>' : ""
      }</td>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right">${r.assigned}</td>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right">${r.replied}</td>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right">${r.resolved}</td>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;color:#16a34a">${r.handled}</td>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;color:#94a3b8">${r.passthrough}</td>
          <td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right;font-weight:600">${Math.round(r.score * 100)}</td>
        </tr>`;
    })
    .join("");

  const attentionHtml = attention.length
    ? `
      <h3 style="margin:24px 0 8px 0;font-size:14px;color:#dc2626">Needs attention</h3>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151">
        ${attention.map((a) => `<li style="margin:4px 0">${a.message}</li>`).join("")}
      </ul>`
    : "";

  return `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#0f172a">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:24px">
    <h2 style="margin:0;font-size:18px">CS Performance · ${periodLabel}</h2>
    <p style="margin:4px 0 16px 0;color:#64748b;font-size:13px">${report.start}${report.end !== report.start ? ` → ${report.end}` : ""} (IST)</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:16px;border-collapse:collapse;font-size:13px">
      <tr>
        ${stat("Assigned", t.assigned)}
        ${stat("Replied", t.replied)}
        ${stat("Resolved", `${t.resolved} <span style='color:#94a3b8;font-weight:400'>(${t.handled}h/${t.passthrough}p)</span>`)}
        ${stat("Open", t.open)}
      </tr>
    </table>

    ${
      top
        ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:12px 16px;margin-bottom:16px">
            <div style="font-size:11px;text-transform:uppercase;color:#b45309;letter-spacing:0.5px">🏆 Top performer · ${periodLabel}</div>
            <div style="font-size:18px;font-weight:600;margin-top:2px">${cleanName(top.name)}</div>
            <div style="font-size:13px;color:#64748b">Replied ${top.replied} · Handled ${top.handled} · Score ${Math.round(top.score * 100)}</div>
          </div>`
        : ""
    }

    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
      <thead style="background:#f9fafb">
        <tr>
          <th style="padding:8px;text-align:left;font-weight:500;color:#64748b;font-size:11px;text-transform:uppercase">#</th>
          <th style="padding:8px;text-align:left;font-weight:500;color:#64748b;font-size:11px;text-transform:uppercase">Executive</th>
          <th style="padding:8px;text-align:right;font-weight:500;color:#64748b;font-size:11px;text-transform:uppercase">Asn</th>
          <th style="padding:8px;text-align:right;font-weight:500;color:#64748b;font-size:11px;text-transform:uppercase">Rep</th>
          <th style="padding:8px;text-align:right;font-weight:500;color:#64748b;font-size:11px;text-transform:uppercase">Res</th>
          <th style="padding:8px;text-align:right;font-weight:500;color:#64748b;font-size:11px;text-transform:uppercase">Hnd</th>
          <th style="padding:8px;text-align:right;font-weight:500;color:#64748b;font-size:11px;text-transform:uppercase">Pst</th>
          <th style="padding:8px;text-align:right;font-weight:500;color:#64748b;font-size:11px;text-transform:uppercase">Score</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    ${attentionHtml}

    <p style="margin-top:20px;font-size:11px;color:#94a3b8">
      Handled = exec replied AND closed · Passthrough = AI replied, exec closed without replying.
      Score = 0.5 × norm(replied) + 0.5 × norm(handled).
    </p>
  </div>
</body></html>`;
}

function stat(label: string, value: number | string): string {
  return `
    <td style="padding:0 4px;width:25%">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b">${label}</div>
        <div style="font-size:22px;font-weight:600;margin-top:2px">${value}</div>
      </div>
    </td>`;
}
