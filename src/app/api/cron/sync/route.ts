import type { NextRequest } from "next/server";
import { runSync, SyncBusyError } from "@/lib/sync";
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
    if (err instanceof SyncBusyError) {
      // Another sync was already in flight when this trigger fired (e.g.
      // GH Actions + AutoSync overlapped). Not a failure — return 200.
      return Response.json({
        ok: true,
        skipped: true,
        message: err.message,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
