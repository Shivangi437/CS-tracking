/**
 * Typed Freshdesk REST v2 client.
 * - HTTP Basic auth (API_KEY:X)
 * - Handles 429 with Retry-After + exponential backoff
 * - Paginates list endpoints via the Link header
 */

import { env } from "@/lib/env";
import { FRESHDESK_PAGE_SIZE } from "@/lib/config";

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
    const res = await fetch(url, {
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      // Freshdesk doesn't support our caching here; never cache.
      cache: "no-store",
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      if (attempt >= maxRetries) {
        throw new RateLimitError(retryAfter);
      }
      const wait = Math.max(retryAfter, 1) * 1000;
      await sleep(wait + jitter());
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
