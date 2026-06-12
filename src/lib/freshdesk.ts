/**
 * Typed Freshdesk REST v2 client.
 * - HTTP Basic auth (API_KEY:X)
 * - Handles 429 with Retry-After + exponential backoff
 * - Paginates list endpoints via the Link header
 */

import { env } from "@/lib/env";
import {
  FRESHDESK_LOW_REMAINING_THRESHOLD,
  FRESHDESK_PAGE_SIZE,
  FRESHDESK_TOKEN_BURST,
  FRESHDESK_TOKEN_RATE_PER_MIN,
} from "@/lib/config";

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Freshdesk rate limit hit; retry after ${retryAfterSeconds}s`);
    this.name = "RateLimitError";
  }
}

export class FreshdeskHttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`Freshdesk HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "FreshdeskHttpError";
  }
}

// ---------- Types (minimal, only what we persist) ----------

export interface FreshdeskAgentContact {
  name: string;
  email: string | null;
}

export interface FreshdeskAgent {
  id: number;
  available: boolean;
  contact: FreshdeskAgentContact;
}

export interface FreshdeskTicketStats {
  resolved_at: string | null;
  first_responded_at: string | null;
  reopened_at: string | null;
}

export interface FreshdeskTicket {
  id: number;
  subject: string | null;
  status: number;
  priority: number;
  responder_id: number | null;
  group_id: number | null;
  created_at: string;
  updated_at: string;
  spam: boolean;
  deleted: boolean;
  stats?: FreshdeskTicketStats;
}

export interface FreshdeskConversation {
  id: number;
  user_id: number | null;
  incoming: boolean;
  private: boolean;
  body_text: string | null;
  created_at: string;
}

// ---------- Core request helper ----------

const BASE = () => `https://${env.FRESHDESK_DOMAIN}.freshdesk.com/api/v2`;

function authHeader(): string {
  return `Basic ${Buffer.from(`${env.FRESHDESK_API_KEY}:X`).toString("base64")}`;
}

// ---------- Per-minute token bucket (rate limiter) ----------

/**
 * Token-bucket throughput limiter for the Freshdesk API.
 *
 * This is NOT a concurrency limiter (that's `p-limit`, used elsewhere).
 * Concurrency caps how many requests run in parallel; this caps how many
 * requests are allowed to START in any given minute. Both apply: a request
 * must pass `p-limit` *and* `acquire()` here before it fires.
 *
 * Tokens drip in continuously at `ratePerMin / 60` per second. Each fetch
 * call must `acquire()` a token before issuing the request; if the bucket
 * is empty the call sleeps until the next drip arrives.
 *
 * A global `cooldownUntil` timestamp lets us pause the whole sync — when
 * any request returns 429 or X-Ratelimit-Remaining drops too low, we set
 * the cooldown and every other concurrent worker will see it on their next
 * `acquire()` and wait. This is the sync-wide pause behaviour: one 429
 * halts the whole sync, not just retries one request.
 */
class FreshdeskRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private cooldownUntil = 0;
  private readonly capacity: number;
  private readonly refillRatePerSec: number;

  constructor(opts: { capacity: number; ratePerMin: number }) {
    this.capacity = opts.capacity;
    this.refillRatePerSec = opts.ratePerMin / 60;
    this.tokens = opts.capacity; // start full so the first call doesn't wait
    this.lastRefill = Date.now();
  }

  /**
   * Wait for a token. Must be awaited before every Freshdesk fetch.
   * Loops because a global cooldown can be set while we're sleeping for
   * a token — we re-check both gates each iteration.
   */
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();

      // Gate 1: global cooldown (set by 429 or low X-Ratelimit-Remaining)
      if (this.cooldownUntil > now) {
        await sleep(this.cooldownUntil - now);
        continue;
      }

      // Refill: tokens drift up at refillRatePerSec, capped at capacity.
      const elapsedSec = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(
        this.capacity,
        this.tokens + elapsedSec * this.refillRatePerSec
      );
      this.lastRefill = now;

      // Gate 2: do we have a token?
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      // Sleep just long enough for the next token to drip in, then loop.
      const waitMs = ((1 - this.tokens) / this.refillRatePerSec) * 1000;
      await sleep(Math.max(waitMs, 10));
    }
  }

  /** Pause the whole sync for `ms` milliseconds. Idempotent / monotonic. */
  pauseFor(ms: number): void {
    const until = Date.now() + ms;
    if (until > this.cooldownUntil) this.cooldownUntil = until;
  }

  /**
   * Observe the X-Ratelimit-Remaining header from a response. If headroom
   * is too low, pause everyone for a full minute window so the AI bot has
   * room to breathe.
   */
  observeRemaining(remaining: number | null): void {
    if (remaining == null) return;
    if (remaining < FRESHDESK_LOW_REMAINING_THRESHOLD) {
      this.pauseFor(60_000);
    }
  }
}

/** Single shared limiter — all Freshdesk calls go through it. */
const rateLimiter = new FreshdeskRateLimiter({
  capacity: FRESHDESK_TOKEN_BURST,
  ratePerMin: FRESHDESK_TOKEN_RATE_PER_MIN,
});

interface RequestOptions {
  /** Hard cap on retries for 429 / transient 5xx. */
  maxRetries?: number;
}

async function apiRequest<T>(
  path: string,
  { maxRetries = 4 }: RequestOptions = {}
): Promise<{ data: T; headers: Headers }> {
  const url = path.startsWith("http") ? path : `${BASE()}${path}`;
  let attempt = 0;

  while (true) {
    // Gate every request through the per-minute token bucket BEFORE firing.
    // This is the throughput cap that p-limit can't provide.
    await rateLimiter.acquire();

    const res = await fetch(url, {
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      // Freshdesk doesn't support our caching here; never cache.
      cache: "no-store",
    });

    // Observe rate-limit headroom on every response. If we're approaching
    // the account ceiling, pause the whole sync for a minute so the AI bot
    // sharing the same budget has room to operate.
    const remainingHeader = res.headers.get("x-ratelimit-remaining");
    if (remainingHeader != null) {
      rateLimiter.observeRemaining(Number(remainingHeader));
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      // Sync-wide pause: every other concurrent worker hits this cooldown
      // on their next acquire(), not just this single retry. Stops the
      // other workers from firing into the closed window.
      rateLimiter.pauseFor(Math.max(retryAfter, 1) * 1000 + jitter());
      if (attempt >= maxRetries) {
        throw new RateLimitError(retryAfter);
      }
      attempt++;
      continue;
    }

    if (res.status >= 500 && res.status < 600) {
      if (attempt >= maxRetries) {
        throw new FreshdeskHttpError(res.status, await res.text());
      }
      const wait = backoff(attempt);
      await sleep(wait);
      attempt++;
      continue;
    }

    if (!res.ok) {
      throw new FreshdeskHttpError(res.status, await res.text());
    }

    const data = (await res.json()) as T;
    return { data, headers: res.headers };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(): number {
  return Math.floor(Math.random() * 200);
}

function backoff(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** attempt) + jitter();
}

/** Parse a Link header for the `next` URL. */
function nextLink(headers: Headers): string | null {
  const link = headers.get("link") ?? headers.get("Link");
  if (!link) return null;
  const m = link.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

// ---------- Endpoints ----------

export async function listAgents(): Promise<FreshdeskAgent[]> {
  const out: FreshdeskAgent[] = [];
  let url: string | null = `/agents?per_page=${FRESHDESK_PAGE_SIZE}`;
  while (url) {
    const { data, headers } = await apiRequest<FreshdeskAgent[]>(url);
    out.push(...data);
    url = nextLink(headers);
  }
  return out;
}

/**
 * Fetches tickets updated since `since` (ISO string), paginated, including stats.
 * Yields each page so the caller can stream them into the DB without buffering
 * the entire 30-day backfill in memory.
 */
export async function* iterateTicketsUpdatedSince(
  since: Date
): AsyncGenerator<FreshdeskTicket[]> {
  const iso = since.toISOString();
  let url: string | null =
    `/tickets?updated_since=${encodeURIComponent(iso)}` +
    `&include=stats&per_page=${FRESHDESK_PAGE_SIZE}&order_by=updated_at&order_type=asc`;

  while (url) {
    const { data, headers } = await apiRequest<FreshdeskTicket[]>(url);
    yield data;
    url = nextLink(headers);
  }
}

export async function listConversations(
  ticketId: number
): Promise<FreshdeskConversation[]> {
  const out: FreshdeskConversation[] = [];
  let url: string | null =
    `/tickets/${ticketId}/conversations?per_page=${FRESHDESK_PAGE_SIZE}`;
  while (url) {
    const { data, headers } = await apiRequest<FreshdeskConversation[]>(url);
    out.push(...data);
    url = nextLink(headers);
  }
  return out;
}
