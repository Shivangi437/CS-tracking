# CS Performance Tracker

Tracks per-executive customer support performance for BookLeaf, whose support runs on
Freshdesk with an AI auto-replier in front of a human CS team.

## What it measures (and how it handles the AI)

For every human CS executive, per IST day:

| Metric          | Definition                                                                                |
| --------------- | ----------------------------------------------------------------------------------------- |
| **Assigned**    | Tickets currently assigned to the exec (`responder_id`) that entered the period           |
| **Replied**     | Distinct tickets the exec posted ≥1 public reply on — **AI replies excluded**             |
| **Resolved**    | Tickets with `resolved_at` in-period, credited to `responder_id`                          |
| **Handled**     | Resolved **and** the exec had ≥1 human reply on it (counts toward merit)                  |
| **Passthrough** | Resolved with **no** human reply (AI handled it, exec just closed) — visibility only      |
| **Open**        | Currently assigned, not resolved                                                          |

**Top performer score** = `0.5 × norm(replied) + 0.5 × norm(handled)`. Passthrough
is deliberately excluded so AI-handled closes can't inflate human merit.

Weights and "needs attention" thresholds live in [`src/lib/config.ts`](src/lib/config.ts).

## Architecture

```
Vercel Cron ──▶ /api/cron/sync ──▶ Freshdesk REST API
                       │                  │
                       ▼                  ▼
                   Neon Postgres ◀── upserts (agents, tickets, replies)
                       │
                       ├─▶ /today, /week, /agents, /summaries  (dashboard)
                       └─▶ /api/cron/daily-summary, /weekly-summary  (Resend + Slack)
```

No Freshdesk calls happen on page load — the dashboard and summary jobs read only
from Postgres.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- Recharts for charts
- Drizzle ORM + Neon Postgres
- Resend for email · Slack incoming webhook
- Vercel hosting + Vercel Cron
- All time math in `Asia/Kolkata` via `date-fns-tz`

## Local development

```bash
cp .env.example .env.local
# fill in the values (see "Setup checklist" below)

npm install
npm run db:push       # create tables in your Neon database
npm run dev           # http://localhost:3000
```

Other scripts:

```bash
npm run build         # production build (must pass before deploy)
npm run typecheck     # tsc --noEmit
npm run db:generate   # emit a SQL migration into ./drizzle
npm run db:studio     # browse the DB
```

## Setup checklist

### 1. Neon Postgres
Create a fresh database (separate from any other BookLeaf app to avoid table
collisions). Copy the connection string into `DATABASE_URL`. Then:

```bash
npm run db:push
```

### 2. Freshdesk API key
Freshdesk → Profile Settings → "Your API Key". Put in `FRESHDESK_API_KEY`.
Domain is the subdomain only (e.g. `bookleafpublishing` for
`bookleafpublishing.freshdesk.com`).

### 3. AI_AGENT_IDS (critical)
The whole tracker hinges on knowing which Freshdesk agent IDs belong to the
AI auto-replier — without this list, every ticket looks human-replied and
"Handled" loses meaning.

Find them with:

```bash
curl -u "$FRESHDESK_API_KEY:X" \
  "https://$FRESHDESK_DOMAIN.freshdesk.com/api/v2/agents?per_page=100" \
  | jq '.[] | {id, name, email: .contact.email}'
```

Set `AI_AGENT_IDS=12345,67890` (comma-separated, no spaces required).

Optional: set `RAMA_AGENT_ID` to the CS manager's id so tickets still parked
with her (escalated but not yet assigned to an executive) are excluded from
each executive's "Assigned" count.

### 4. Resend
Verify your sending domain at resend.com, generate an API key, then set:

- `RESEND_API_KEY`
- `SUMMARY_EMAIL_FROM` — verified sender (e.g. `cs-tracker@bookleaf.in`)
- `SUMMARY_EMAIL_TO` — comma-separated recipient list

### 5. Slack
Create an Incoming Webhook for the channel that should receive summaries; set
`SLACK_WEBHOOK_URL`.

### 6. Auth secrets
- `DASHBOARD_PASSWORD` — shared password for the team
- `CRON_SECRET` — random string; cron endpoints require
  `Authorization: Bearer $CRON_SECRET`

## Vercel deployment

```bash
vercel link
vercel env pull .env.local      # if you've set envs in the Vercel UI
vercel --prod
```

### Cron schedule (UTC; IST = UTC+5:30)

| Job             | Schedule           | IST                                  |
| --------------- | ------------------ | ------------------------------------ |
| Sync            | `*/30 4-13 * * *`  | every 30 min, 10:00–18:30 work hours |
| Daily summary   | `30 12 * * *`      | 18:00 IST                            |
| Weekly summary  | `30 12 * * 5`      | 18:00 IST on Fridays                 |

Configured in `vercel.json` (added in M7).

### Hobby plan fallback

Vercel Hobby effectively allows daily crons only. To run the 30-minute sync on
a free plan, point an external scheduler at the same secured endpoint:

```
POST https://<deployment>.vercel.app/api/cron/sync
Authorization: Bearer <CRON_SECRET>
```

Options (pick one):

- **cron-job.org** — free, per-URL HTTP cron, supports custom headers.
- **Upstash QStash** — generous free tier, retries built in.
- **GitHub Actions cron** — `.github/workflows/sync.yml` with `schedule:` + a
  `curl` step using a repo secret for the bearer token.

## Project layout

```
src/
  app/                Next.js App Router pages + API routes
  lib/
    config.ts         Score weights + tunable thresholds (single source of truth)
    env.ts            Centralised env reader (always .trim())
    db/
      schema.ts       Drizzle schema
      client.ts       Neon HTTP driver + Drizzle client
drizzle/              Generated SQL migrations (git-tracked)
drizzle.config.ts     Drizzle Kit config
vercel.json           Cron schedule (added in M7)
```

## Status

Built milestone-by-milestone. See commit log.
