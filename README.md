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

### 6. Cron secret
- `CRON_SECRET` — random string; cron endpoints require
  `Authorization: Bearer $CRON_SECRET`. Vercel Cron and the GitHub Actions
  sync workflow both send this header.

```bash
openssl rand -hex 32         # CRON_SECRET
```

### Dashboard access

The dashboard is open access — anyone with the URL can view it. This is an
internal team tool; share the URL only in private channels. To restrict
access later, see commit history: revert `feat: remove auth gate` to get
the shared-password gate back, or add per-user auth with Clerk/Auth0/etc.

### Initial 30-day backfill

The first sync pulls every ticket updated in the last 30 days plus its
conversations — can run 10+ minutes. Vercel HTTP requests time out before
that, so run it locally via the CLI helper after `db:migrate` completes:

```bash
npm run sync
```

Subsequent 30-min cron syncs only fetch what changed in the last interval and
finish in well under 60 s.

## Vercel deployment

```bash
vercel link
vercel env pull .env.local      # if you've set envs in the Vercel UI
vercel --prod
```

Push all env vars from `.env.local` into the project before deploying:

```bash
# one-time
for k in FRESHDESK_DOMAIN FRESHDESK_API_KEY AI_AGENT_IDS RAMA_AGENT_ID \
         DATABASE_URL RESEND_API_KEY SUMMARY_EMAIL_FROM SUMMARY_EMAIL_TO \
         SLACK_WEBHOOK_URL CRON_SECRET; do
  v=$(grep "^$k=" .env.local | cut -d= -f2-)
  [ -n "$v" ] && echo "$v" | vercel env add "$k" production
done
```

### Cron schedule (UTC; IST = UTC+5:30)

| Job             | Schedule           | IST                                  |
| --------------- | ------------------ | ------------------------------------ |
| Sync            | `*/30 4-13 * * *`  | every 30 min, 10:00–18:30 work hours |
| Daily summary   | `30 12 * * *`      | 18:00 IST                            |
| Weekly summary  | `30 12 * * 5`      | 18:00 IST on Fridays                 |

Configured in [`vercel.json`](vercel.json). Vercel Cron requests automatically
include `Authorization: Bearer ${CRON_SECRET}` once the env var is set.

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
  `curl` step using a repo secret for the bearer token. Sample:

  ```yaml
  on:
    schedule:
      - cron: "*/30 4-13 * * *"   # sync
      - cron: "30 12 * * *"        # daily summary
      - cron: "30 12 * * 5"        # weekly summary
  jobs:
    poke:
      runs-on: ubuntu-latest
      steps:
        - run: |
            case "$GITHUB_EVENT_NAME-$GITHUB_EVENT_PATH" in
              *) path=sync;;
            esac
            curl -fsS -X POST "https://$DEPLOY/api/cron/$path" \
              -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
          env:
            DEPLOY: ${{ vars.DEPLOY_HOST }}
  ```

### Manual triggers

Both summary endpoints accept `?force=true` to re-send the email + Slack even
when the day's row already exists (useful for testing):

```bash
curl -X POST "https://<deployment>/api/cron/daily-summary?force=true" \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Project layout

```
src/
  app/
    today/, week/, agents/, agents/[id]/, summaries/   Dashboard pages
    login/                                             Password gate
    api/
      auth/login/, auth/logout/                        Session endpoints
      cron/sync/, cron/daily-summary/, cron/weekly-summary/   Bearer-auth'd jobs
  lib/
    config.ts         Score weights + attention thresholds (single source of truth)
    env.ts            Centralised env reader (always .trim())
    dates.ts          IST date helpers (today, week range, IST shift)
    db/
      schema.ts       Drizzle schema
      client.ts       Neon HTTP driver + Drizzle client (lazy)
    freshdesk.ts      Typed REST client + 429 backoff + Link-header pagination
    sync.ts           Sync orchestrator (idempotent upserts, watermark, partial progress)
    rollups.ts        agent_daily_stats recompute + tickets.resolution_class stamp
    queries.ts        Read-only queries for the dashboard + summaries
    attention.ts      Auto "needs attention" flag generation
    email.ts          Resend HTML summary
    slack.ts          Slack Block Kit summary
    summary.ts        Orchestrates sync → compute → upsert summaries → send
    session.ts        HMAC session-cookie helpers (shared by proxy + login)
    actions.ts        Server actions (e.g. triggerSyncAction for the dashboard)
  components/
    Leaderboard.tsx, TopPerformerCard.tsx, StatCard.tsx,
    RunSyncButton.tsx, SyncBadge.tsx,
    WeekChart.tsx, AgentSeriesChart.tsx        (Recharts; client components)
  proxy.ts            Next 16 proxy (was middleware) — password gate
scripts/
  apply-migrations.mjs   Non-interactive migration applier (npm run db:migrate)
  sync.ts                CLI sync — use for the initial 30-day backfill (npm run sync)
drizzle/              Generated SQL migrations (git-tracked)
drizzle.config.ts     Drizzle Kit config
vercel.json           Cron schedule
```

## Status

Built milestone-by-milestone:

- **M1** Scaffold + schema
- **M2** Freshdesk client + sync route
- **M3** agent_daily_stats rollup + composite score
- **M4** Today view + leaderboard + top performer
- **M5** Week view + agent detail + summaries archive
- **M6** Daily + weekly summary jobs (Resend + Slack)
- **M7** Password gate + vercel.json crons + this README
