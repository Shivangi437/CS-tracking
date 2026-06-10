import { getSyncHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public sync health endpoint. No secrets returned; safe to leave open.
 * Useful for: the in-layout banner, external uptime monitoring, CI smoke tests.
 */
export async function GET() {
  try {
    const h = await getSyncHealth();
    return Response.json({
      ok: h.level !== "broken",
      ...h,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        level: "broken" as const,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
