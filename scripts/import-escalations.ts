/**
 * One-shot CSV importer for the historical escalations file.
 *
 *   node --env-file=.env.local --import tsx scripts/import-escalations.ts \
 *     data/escalations_clean.csv
 *
 * - Default path: ./data/escalations_clean.csv
 * - Idempotent: every row gets a stable SHA-256 hash from the canonical
 *   source line; INSERT … ON CONFLICT (import_hash) DO NOTHING so re-runs
 *   add zero duplicates.
 * - Derives credit_class / escalation_type / is_public / needs_attention
 *   server-side from src/lib/escalations — never trusts the CSV for these.
 * - Lowercases + trims author_email.
 * - Blank dates/timestamps stay NULL; we never fabricate a timestamp.
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { db } from "@/lib/db/client";
import { escalations } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { deriveAll, normaliseEmail } from "@/lib/escalations";

function parseCsv(text: string): string[][] {
  // Minimal RFC-4180 parser: handles "quoted, fields", embedded "" escapes,
  // and \r\n. CSVs we control don't need streaming.
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // ignore — \n handles it
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function trimOrNull(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function parseBool(v: string | null): boolean {
  if (v == null) return false;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "t";
}

function parseDateOnly(v: string | null): string | null {
  if (v == null) return null;
  // Accepts yyyy-MM-dd; ignores garbage.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function parseTimestamp(v: string | null): Date | null {
  if (v == null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface CsvRow {
  [key: string]: string;
}

function rowsToRecords(rows: string[][]): CsvRow[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj: CsvRow = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj;
  });
}

async function main() {
  const csvPath =
    process.argv[2] ??
    path.join(process.cwd(), "data", "escalations_clean.csv");

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found at ${csvPath}`);
    console.error(
      `Drop the file at data/escalations_clean.csv (headers in snake_case) and re-run.`
    );
    process.exit(2);
  }

  const text = fs.readFileSync(csvPath, "utf8");
  const records = rowsToRecords(parseCsv(text));
  console.log(`[import] parsed ${records.length} CSV rows from ${csvPath}`);
  if (records.length === 0) {
    console.error("Empty CSV.");
    process.exit(1);
  }

  let inserted = 0;
  let skipped = 0;

  for (const rec of records) {
    const channel = trimOrNull(rec.channel);
    if (!channel) {
      // Spec requires channel NOT NULL.
      skipped++;
      continue;
    }
    const medium = trimOrNull(rec.medium);
    const issueText = trimOrNull(rec.issue_text);
    const status = trimOrNull(rec.status) ?? "unlogged";

    const derived = deriveAll({ channel, medium, issueText, status });

    const importHash = createHash("sha256")
      .update(JSON.stringify(rec))
      .digest("hex");

    const row = {
      openedAt: parseDateOnly(trimOrNull(rec.opened_at)),
      acknowledgedAt: parseTimestamp(trimOrNull(rec.acknowledged_at)),
      resolvedAt: parseTimestamp(trimOrNull(rec.resolved_at)),
      channel,
      medium,
      isPublic: derived.isPublic,
      authorName: trimOrNull(rec.author_name),
      authorEmail: normaliseEmail(rec.author_email),
      authorEmailAlt: normaliseEmail(rec.author_email_alt),
      handle: trimOrNull(rec.handle),
      freshdeskTicket: trimOrNull(rec.freshdesk_ticket),
      issueText,
      category: trimOrNull(rec.category),
      status,
      creditClass: derived.creditClass,
      escalationType: derived.escalationType,
      // parent_id wiring is out of scope for the bulk import — pile-ons
      // can be linked manually later via SQL when we know the source post.
      parentId: null as number | null,
      legalThreat: parseBool(rec.legal_threat ?? null),
      needsAttention: derived.needsAttention,
      closureConfirmed: parseBool(rec.closure_confirmed ?? null),
      remediation: trimOrNull(rec.remediation),
      agent: trimOrNull(rec.agent),
      verifiedBy: trimOrNull(rec.verified_by),
      notes: trimOrNull(rec.notes),
      importHash,
    };

    const r = await db
      .insert(escalations)
      .values(row)
      .onConflictDoNothing({ target: escalations.importHash })
      .returning({ id: escalations.id });

    if (r.length > 0) inserted++;
    else skipped++;
  }

  const total = await db.select({ n: sql<number>`COUNT(*)::int` }).from(escalations);
  console.log(
    `[import] done — inserted ${inserted}, skipped ${skipped} (duplicates / bad rows). Table total: ${total[0].n}.`
  );
}

main().catch((err) => {
  console.error("[import] failed:", err);
  process.exit(1);
});
