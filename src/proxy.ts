/**
 * Next 16 renamed `middleware` to `proxy`. This file gates every dashboard
 * page on a session cookie derived from DASHBOARD_PASSWORD. Cron and login
 * endpoints bypass; cron has its own Bearer-token auth.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, tokenMatches } from "@/lib/session";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/cron/")
  ) {
    return NextResponse.next();
  }

  const password = (process.env.DASHBOARD_PASSWORD || "").trim();
  if (!password) {
    return new NextResponse(
      "DASHBOARD_PASSWORD is not set on this deployment.",
      { status: 503 }
    );
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (cookie && tokenMatches(cookie, password)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname === "/" ? "/today" : pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
