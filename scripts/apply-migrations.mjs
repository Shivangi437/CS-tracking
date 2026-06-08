/**
 * Apply generated Drizzle migrations in order against DATABASE_URL.
 *
 * Why this instead of `drizzle-kit push`? Push requires a TTY and prompts to
 * confirm DDL — fine in dev, broken in CI / npm scripts / non-interactive
 * shells. This applies whatever lives in ./drizzle/*.sql with no prompts.
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

const dir = "drizzle";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  const stmts = text
    .split(/--> statement-breakpoint/)
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`Applying ${f} (${stmts.length} statements)`);
  for (const s of stmts) {
    await sql.query(s);
  }
}
console.log("Done.");
