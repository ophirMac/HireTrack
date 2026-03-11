# HireTrack

A production-grade personal job-application tracking platform that connects to your Gmail inbox, automatically scans emails, detects hiring pipeline activity using AI, and displays everything in a clean SaaS-style dashboard.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND  (Next.js 14 + Tailwind)  — localhost:3000        │
│                                                             │
│  /           → Dashboard (all companies + status)          │
│  /companies/:id → Company detail + timeline                │
│  /scan       → Scan monitor + progress + run logs          │
└──────────────────────┬──────────────────────────────────────┘
                       │  REST API (SWR polling)
┌──────────────────────▼──────────────────────────────────────┐
│  BACKEND   (Express + TypeScript)  — localhost:3001         │
│                                                             │
│  /health             health check                           │
│  /auth/google        OAuth2 initiation                      │
│  /auth/callback      OAuth2 token exchange                  │
│  /api/companies      list + detail                          │
│  /api/scan/status    progress + run logs                    │
│  /api/scan/trigger   manual scan trigger                    │
└──────┬────────────────────────────────────────────────────--┘
       │
       ├── Gmail API (googleapis)   ← reads your inbox
       ├── OpenAI API (gpt-4o-mini) ← classifies + extracts
       └── SQLite (node:sqlite)     ← stores everything
```

### Folder Structure

```
HireTrack/
├── package.json              # npm workspaces root
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── data/                 # SQLite DB + OAuth tokens (gitignored)
│   ├── logs/                 # Winston logs (gitignored)
│   └── src/
│       ├── index.ts          # Express server entry point
│       ├── db/
│       │   ├── schema.sql    # All CREATE TABLE + indexes
│       │   └── index.ts      # Typed query functions
│       ├── services/
│       │   ├── gmail.service.ts    # OAuth2 + message fetching + parsing
│       │   ├── openai.service.ts   # classify() + extract()
│       │   ├── scanner.service.ts  # Pipeline orchestration
│       │   ├── company.service.ts  # Dedup + aggregation logic
│       │   └── logo.service.ts     # Logo resolution + caching
│       ├── jobs/
│       │   └── scheduler.ts        # node-cron daily scheduler
│       ├── routes/
│       │   ├── auth.ts
│       │   ├── companies.ts
│       │   └── scan.ts
│       ├── middleware/
│       │   └── error.ts
│       ├── types/
│       │   └── node-sqlite.d.ts    # Type declarations for node:sqlite
│       └── utils/
│           ├── logger.ts       # Winston logger
│           └── retry.ts        # withRetry + withTimeout + sleep
└── frontend/
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.ts
    ├── app/
    │   ├── layout.tsx          # Root layout (sidebar)
    │   ├── page.tsx            # Dashboard page
    │   ├── companies/[id]/page.tsx  # Company detail
    │   └── scan/page.tsx       # Scan monitor
    ├── components/
    │   ├── Sidebar.tsx
    │   ├── StatusBadge.tsx     # Color-coded status pills
    │   ├── CompanyCard.tsx     # Logo + name + status + meta
    │   ├── Timeline.tsx        # Chronological interaction list
    │   └── ScanProgressPanel.tsx # Progress bar + metrics + run log
    └── lib/
        ├── types.ts            # Shared TypeScript types
        └── api.ts              # fetch() wrappers for all endpoints
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `companies` | One row per employer. Domain as dedup key. |
| `emails` | Raw Gmail messages. `gmail_message_id` UNIQUE. |
| `job_interactions` | Job-related emails with extracted structured data. |
| `scan_runs` | Append-only log of every scan execution. |
| `sync_state` | Single-row cursor: last page token + timestamps. |
| `logo_cache` | Persisted logo URL resolutions per domain. |

### Application Status Values

| Status | Meaning |
|---|---|
| `applied` | You submitted an application |
| `confirmation` | Application received/acknowledged |
| `recruiter_reachout` | Cold outreach from a recruiter |
| `interview` | Interview scheduled or conducted |
| `assignment` | Take-home test or coding challenge |
| `rejection` | Application was declined |
| `offer` | Job offer extended |
| `unknown` | Cannot determine |

---

## Quick Start

### 1. Prerequisites

- Node.js v22.5+ (uses built-in `node:sqlite`)
- Gmail account
- Google Cloud project with Gmail API enabled
- OpenAI API key

### 2. Google OAuth2 Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable **Gmail API**: APIs & Services → Library → Gmail API → Enable
4. Create OAuth credentials: APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3001/auth/callback`
5. Copy the **Client ID** and **Client Secret**

### 3. Installation

```bash
# Clone and install all dependencies
git clone <repo>
cd HireTrack
npm install
```

### 4. Configure Environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```
GOOGLE_CLIENT_ID=your_client_id_from_step_2
GOOGLE_CLIENT_SECRET=your_client_secret_from_step_2
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback
OPENAI_API_KEY=sk-...
SCAN_START_DATE=2026/01/01
```

### 5. Connect Gmail (One-Time)

```bash
# Start backend first
npm run dev:backend
```

Open your browser and navigate to:
```
http://localhost:3001/auth/google
```

Complete the Google consent screen. You'll be redirected back to the app with `?auth=success`.

Tokens are saved to `backend/data/tokens.json` and auto-refreshed.

### 6. Run the Full Stack

```bash
# Terminal 1: backend (port 3001)
npm run dev:backend

# Terminal 2: frontend (port 3000)
npm run dev:frontend

# Or both at once:
npm run dev
```

Open http://localhost:3000

---

## How the System Works

### Initial Historical Scan

On first boot (after Gmail auth), the scheduler automatically:

1. Detects `history_scan_completed = 0` in `sync_state`
2. Calls Gmail API with query `after:2026/01/01` (configurable via `SCAN_START_DATE`)
3. Gets `resultSizeEstimate` to display progress percentage
4. Paginates through ALL messages, 100 per page
5. For each page:
   - Fetches full message details (25 at a time, 400ms batch delay)
   - Runs OpenAI classifier on each email (gpt-4o-mini, ~50ms each)
   - For job-related emails: runs full extraction → creates `job_interaction`
   - Saves `pageToken` to `sync_state` after each page (crash-safe resume)
6. When complete: sets `history_scan_completed = 1`, clears `pageToken`

**If the server crashes mid-scan**, restart it — it resumes from the saved `pageToken`.

### Daily Incremental Scan

After historical scan completes, a cron job runs at **06:00 every day**:

1. Reads `last_scanned_after` from `sync_state`
2. Queries Gmail with `after:YYYY/MM/DD`
3. Processes only new emails through the same pipeline
4. Updates `last_scanned_after` to current time

### Email Processing Pipeline (per email)

```
gmail_message_id
       │
       ▼
[1] Idempotency check (skip if processed_flag = 1)
       │
       ▼
[2] Fetch full message from Gmail API (with retry + timeout)
       │
       ▼
[3] Upsert to emails table (raw storage)
       │
       ▼
[4] OpenAI classify: job-related? (gpt-4o-mini, cheap, fast)
       │
       ├── No  → mark processed, skip
       │
       └── Yes ▼
[5] OpenAI extract: company, role, status, confidence
       │
       ▼
[6] Company dedup: domain match → name match → create new
       │
       ▼
[7] Logo resolution (background, cached in logo_cache)
       │
       ▼
[8] Create job_interaction record
       │
       ▼
[9] Update company.current_status + last_interaction_at
       │
       ▼
[10] Mark email processed_flag = 1
```

### Company Matching Algorithm

```
Extract sender domain from from_address
    ↓
1. Exact domain match in companies table → return match
    ↓ (no match)
2. AI-extracted domain match → return match
    ↓ (no match)
3. Fuzzy name match (case-insensitive LIKE) → return match
    ↓ (no match)
4. Create new company record
```

Freemail domains (gmail.com, outlook.com, etc.) are excluded from domain matching.

### Status Update Logic

A company's `current_status` is always set to the status of the **most recently received** meaningful interaction.

"Meaningful" statuses (in order of importance):
`offer` > `interview` > `assignment` > `applied` > `recruiter_reachout` > `confirmation`

If the latest email produces status `unknown`, the previous meaningful status is preserved.

---

## Monitor Progress

Visit **http://localhost:3000/scan** to see:
- Progress bar (historical scan %)
- Emails scanned vs. total estimated
- Active scan status
- Full scan run history table with duration + job email counts

Or poll the API directly:
```bash
curl http://localhost:3001/api/scan/status | jq
```

### Trigger a Manual Scan

```bash
curl -X POST http://localhost:3001/api/scan/trigger
```

Or click **Trigger Scan** on the Scan Monitor page.

---

## Operational Notes

### Rate Limiting
- Gmail API: batches of 25 messages / 400ms inter-batch delay
- OpenAI: retried up to 3× with exponential backoff on 429/5xx errors
- All external calls have 15s timeouts

### Idempotency
- `gmail_message_id` UNIQUE — duplicate emails are never stored twice
- `email_id` UNIQUE on `job_interactions` — AI extraction runs exactly once per email
- `processed_flag = 1` guards against re-processing on restart
- Historical scan cursor persisted after every page — safe to restart at any time

### Crash Recovery
On restart, the server:
1. Detects any stale `running` scan_run and marks it `failed`
2. Resumes from the saved `last_page_token` in `sync_state`
3. Skips already-processed emails via `processed_flag`

### Logs
- Console: colored, human-readable
- `backend/logs/combined.log`: all levels (JSON)
- `backend/logs/error.log`: errors only (JSON)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js v22.5+ |
| Backend framework | Express 4 + TypeScript |
| Database | SQLite via `node:sqlite` (built-in, no compilation) |
| Gmail integration | `googleapis` v144 |
| AI extraction | OpenAI `gpt-4o-mini` via `openai` SDK |
| Scheduler | `node-cron` |
| Logging | `winston` |
| Frontend | Next.js 14 (App Router) |
| Styling | Tailwind CSS 3 |
| Data fetching | SWR (with auto-polling) |
