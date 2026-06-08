/**
 * Session cookie helpers shared by the login API and the proxy. Kept in one
 * file so the cookie name and token derivation can't drift apart.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "cs_session";
export const SESSION_MAX_AGE_DAYS = 30;

export function deriveSessionToken(password: string): string {
  return createHmac("sha256", password)
    .update("cs-performance-tracker-session-v1")
    .digest("hex");
}

export function tokenMatches(cookieValue: string, password: string): boolean {
  const expected = deriveSessionToken(password);
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
