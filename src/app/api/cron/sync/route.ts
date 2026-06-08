import type { NextRequest } from "next/server";
import { runSync } from "@/lib/sync";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 * Vercel Cron sends this header automatically when configured in vercel.json.
 *
 * Returns a JSON summary so the dashboard "Run sync" button can show progress.
 */
async function handle(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;
  if (auth !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSync();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
