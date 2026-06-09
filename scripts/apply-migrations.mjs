/**
 * Apply generated Drizzle migrations in order against DATABASE_URL.
 *
 * Why this instead of `drizzle-kit push`? Push requires a TTY and prompts to
 * confirm DDL — fine in dev, broken in CI / npm scripts / non-interactive
 * shells. This applies whatever lives in ./drizzle/*.sql with no prompts.
 *
 * Tracks applied migrations in `_migrations(filename TEXT PRIMARY KEY,
 * applied_at TIMESTAMPTZ DEFAULT now())` so re-runs are idempotent.
 *
 *   node --env-file=.env.local scripts/apply-migrations.mjs
 */
import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";

const url = (process.env.DATABASE_URL || "").trim();
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const sql = neon(url);

// Ledger table — track which migration files have been applied.
await sql.query(`
  CREATE TABLE IF NOT EXISTS _migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

const already = new Set(
  (await sql.query("SELECT filename FROM _migrations")).map((r) => r.filename)
);

// Special-case: pre-existing DB (created before the ledger existed). If the
// first migration's tables exist but nothing's in the ledger, assume it ran.
if (already.size === 0) {
  const r = await sql.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agents'
  `);
  if (r.length > 0) {
    console.log("Detected pre-existing schema; marking 0000 as applied.");
    await sql.query(
      `INSERT INTO _migrations (filename) VALUES ('0000_lean_rocket_racer.sql')`
    );
    already.add("0000_lean_rocket_racer.sql");
  }
}

const dir = "drizzle";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let appliedCount = 0;
for (const f of files) {
  if (already.has(f)) {
    console.log(`Skipping ${f} (already applied)`);
    continue;
  }
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  const stmts = text
    .split(/--> statement-breakpoint/)
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`Applying ${f} (${stmts.length} statements)`);
  for (const s of stmts) {
    await sql.query(s);
  }
  await sql.query(`INSERT INTO _migrations (filename) VALUES ($1)`, [f]);
  appliedCount++;
}
console.log(`Done. ${appliedCount} new migration(s) applied.`);
