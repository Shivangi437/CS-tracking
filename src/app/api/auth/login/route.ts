import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_DAYS,
  deriveSessionToken,
  tokenMatches,
} from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/today");

  // Allow only same-origin redirect targets.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/today";

  const expectedPassword = env.DASHBOARD_PASSWORD;

  if (!tokenMatches(deriveSessionToken(password), expectedPassword)) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "wrong");
    url.searchParams.set("next", safeNext);
    return NextResponse.redirect(url, { status: 303 });
  }

  const res = NextResponse.redirect(new URL(safeNext, req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, deriveSessionToken(expectedPassword), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
  });
  return res;
}
