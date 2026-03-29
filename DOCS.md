# HireTrack — Full Documentation

> Last updated: 2026-03-29

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Frontend](#frontend)
   - [Pages & Routes](#pages--routes)
   - [Components](#components)
   - [State Management](#state-management)
   - [Types & Interfaces](#types--interfaces)
6. [Backend](#backend)
   - [API Endpoints](#api-endpoints)
   - [Services](#services)
   - [Utilities](#utilities)
7. [Database Schema](#database-schema)
8. [Authentication](#authentication)
9. [Email Processing Pipeline](#email-processing-pipeline)
10. [Configuration](#configuration)
11. [User Workflows](#user-workflows)
12. [Architecture Notes](#architecture-notes)

---

## Overview

HireTrack is a single-user, local-first job application tracker. It combines two workflows:

- **Automatic:** Connects to Gmail via OAuth2 and uses OpenAI to scan, classify, and extract job-related emails — automatically populating a company dashboard with application statuses.
- **Manual:** A lead management system for proactively tracking companies before applying — logging outreach moves, contacts, and converting leads into the main dashboard.

All data is stored locally in SQLite. No external storage or accounts required beyond Gmail + OpenAI API keys.

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|-----------|---------|---------|
| Next.js | 14 (App Router) | React framework, routing |
| TypeScript | 5.4.3 | Type safety |
| Tailwind CSS | 3 | Styling (dark theme) |
| SWR | — | Data fetching + polling |
| date-fns | — | Date formatting |
| clsx | — | Conditional classNames |

### Backend
| Technology | Version | Purpose |
|-----------|---------|---------|
| Node.js | v22.5+ | Runtime |
| Express | 4 | HTTP server |
| TypeScript | — | Type safety |
| SQLite | `node:sqlite` (built-in) | Database |
| Google APIs | v144 | Gmail OAuth2 + read access |
| OpenAI SDK | v4.29.0 | Email classification + extraction |
| node-cron | — | Daily incremental scan |
| Winston | — | Structured logging |
| axios | — | HTTP client |

---

## Project Structure

```
HireTrack/
├── package.json              # Workspace root (npm workspaces)
│
├── backend/
│   ├── src/
│   │   ├── index.ts          # Express app entry, route registration, cron setup
│   │   ├── db/
│   │   │   └── index.ts      # SQLite init, all DB types, schema creation
│   │   ├── routes/
│   │   │   ├── auth.ts       # Google OAuth2 routes
│   │   │   ├── companies.ts  # Company CRUD + contacts
│   │   │   ├── leads.ts      # Lead CRUD + moves + contacts
│   │   │   └── scan.ts       # Scan trigger + status
│   │   ├── services/
│   │   │   ├── gmail.service.ts    # Gmail OAuth2 + message fetching
│   │   │   ├── openai.service.ts   # AI classification + extraction
│   │   │   ├── scanner.service.ts  # Pipeline orchestration
│   │   │   ├── company.service.ts  # Company dedup + aggregation
│   │   │   └── logo.service.ts     # Logo URL resolution + cache
│   │   └── utils/
│   │       ├── retry.ts      # withRetry(), withTimeout(), sleep()
│   │       └── logger.ts     # Winston logger instance
│   ├── data/
│   │   ├── hiretrack.db      # SQLite database (gitignored)
│   │   └── tokens.json       # Gmail OAuth tokens (gitignored)
│   └── logs/
│       ├── combined.log      # All log levels (JSON)
│       └── error.log         # Errors only (JSON)
│
└── frontend/
    ├── app/
    │   ├── layout.tsx         # Root layout (Sidebar + main content)
    │   ├── page.tsx           # Dashboard (/)
    │   ├── leads/
    │   │   ├── page.tsx       # Leads list (/leads)
    │   │   └── [id]/
    │   │       └── page.tsx   # Lead detail (/leads/:id)
    │   ├── companies/
    │   │   └── [id]/
    │   │       └── page.tsx   # Company detail (/companies/:id)
    │   ├── scan/
    │   │   └── page.tsx       # Scan monitor (/scan)
    │   └── quick-lead/
    │       └── page.tsx       # Quick add lead (/quick-lead)
    ├── components/
    │   ├── Sidebar.tsx
    │   ├── CompanyCard.tsx
    │   ├── StatusBadge.tsx
    │   ├── StatusSelect.tsx
    │   ├── Timeline.tsx
    │   ├── LeadForm.tsx
    │   ├── LeadStatusBadge.tsx
    │   ├── LeadMoveTimeline.tsx
    │   ├── ContactsPanel.tsx
    │   ├── CompanyContactsPanel.tsx
    │   └── ScanProgressPanel.tsx
    └── lib/
        ├── types.ts           # Shared TypeScript interfaces
        └── api.ts             # API base URL + fetch helpers
```

---

## Getting Started

### Prerequisites
- Node.js v22.5+
- npm
- Google Cloud project with Gmail API enabled + OAuth2 credentials
- OpenAI API key

### Setup

```bash
# Install all workspaces
npm install

# Configure backend
cp backend/.env.example backend/.env
# Fill in: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OPENAI_API_KEY, SCAN_START_DATE

# Configure frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > frontend/.env.local

# Start both servers
npm run dev
```

Backend runs on `http://localhost:3001`, frontend on `http://localhost:3000`.

On first launch, visit the dashboard and click "Connect Gmail" to complete OAuth2.

---

## Frontend

### Pages & Routes

#### `/` — Dashboard
- Lists all companies with application status, interaction count, and logo
- Filter by status (`applied` / `rejected` / `offer`)
- Search by company name
- Delete companies
- Links to company detail pages

#### `/leads` — Lead List
- Lists all leads with status badge, role, company, and move count
- Filter by lead status
- Create new lead (inline form via `LeadForm`)
- Delete leads
- Links to lead detail pages

#### `/leads/:id` — Lead Detail
- Edit all lead fields (company, role, URL, contact, status, notes)
- `LeadMoveTimeline`: log and view interactions (date, description, person, link)
- `ContactsPanel`: manage outreach contacts with status tracking
- Convert lead to company (creates Company entry, sets status=`converted`)

#### `/companies/:id` — Company Detail
- Shows company info, logo, current status
- Manual status override via `StatusSelect`
- `Timeline`: chronological list of job-related emails for this company
- `CompanyContactsPanel`: contacts extracted from emails
- Source lead info panel (if this company came from a lead)

#### `/scan` — Scan Monitor
- `ScanProgressPanel`: progress bar (historical %), email counts, run stats
- Run history table (paginated)
- Manual scan trigger (historical or incremental)
- Auth status indicator (Gmail connected / not connected)

#### `/quick-lead` — Quick Add Lead
- Input a job URL → AI extracts company name and role
- Pre-fills the `LeadForm` with extracted data
- Saves as a new lead and redirects to lead detail

---

### Components

| Component | File | Description |
|-----------|------|-------------|
| `Sidebar` | `components/Sidebar.tsx` | Left-nav with 4 main routes; Gmail reconnect link when not authenticated |
| `CompanyCard` | `components/CompanyCard.tsx` | Single row in company list: logo, name, status badge, interaction count, delete button |
| `StatusBadge` | `components/StatusBadge.tsx` | Color-coded pill: `applied` (blue), `rejected` (red), `offer` (green) |
| `StatusSelect` | `components/StatusSelect.tsx` | Dropdown to manually override company status; calls `PATCH /api/companies/:id/status` |
| `Timeline` | `components/Timeline.tsx` | Renders job interaction emails in chronological order per company |
| `LeadForm` | `components/LeadForm.tsx` | Create/edit lead fields: company, role, URL, contact person, source, dates, status, notes |
| `LeadStatusBadge` | `components/LeadStatusBadge.tsx` | Color-coded pill for lead statuses |
| `LeadMoveTimeline` | `components/LeadMoveTimeline.tsx` | Chronological log of user actions on a lead (add/delete moves) |
| `ContactsPanel` | `components/ContactsPanel.tsx` | Lead outreach contacts: add, edit, delete, track contact status |
| `CompanyContactsPanel` | `components/CompanyContactsPanel.tsx` | Company contacts extracted from emails; add/edit/delete manually |
| `ScanProgressPanel` | `components/ScanProgressPanel.tsx` | Progress bar, scan stats, run history, manual trigger button |

---

### State Management

SWR is used for all server state. Key patterns:

```typescript
// Auto-polling example
const { data, mutate } = useSWR('/api/companies', fetcher, { refreshInterval: 30000 })

// Optimistic delete
mutate(companies.filter(c => c.id !== id), false)
await fetch(`/api/companies/${id}`, { method: 'DELETE' })
mutate()

// Conditional polling (fast when scan is running)
const interval = isRunning ? 5000 : 30000
useSWR('/api/scan/status', fetcher, { refreshInterval: interval })
```

---

### Types & Interfaces

Defined in `frontend/lib/types.ts`:

```typescript
type ApplicationStatus = 'applied' | 'rejected' | 'offer'
type LeadStatus = 'researching' | 'contacted' | 'waiting_response' | 'preparing_to_apply' | 'applied' | 'converted'
type ContactStatus = 'identified' | 'connected' | 'messaged' | 'replied' | 'referred'
type LeadSource = 'linkedin' | 'email' | 'referral' | 'event' | 'other'

interface Company {
  id: number
  name: string
  domain: string | null
  logo_url: string | null
  current_status: ApplicationStatus
  first_interaction_at: string
  last_interaction_at: string
  interaction_count: number
}

interface Lead {
  id: number
  company_name: string
  role: string | null
  job_url: string | null
  contact_person: string | null
  contact_source: LeadSource | null
  date_first_contacted: string | null
  status: LeadStatus
  notes: string | null
  converted_company_id: number | null
  move_count: number
}

interface LeadMove {
  id: number
  lead_id: number
  date: string
  description: string
  person_contacted: string | null
  link: string | null
}

interface LeadContact {
  id: number
  lead_id: number
  name: string
  role: string | null
  linkedin_url: string | null
  status: ContactStatus
  notes: string | null
}

interface CompanyContact {
  id: number
  company_id: number
  name: string
  role: string | null
  linkedin_url: string | null
  notes: string | null
}

interface JobInteraction {
  id: number
  company_id: number
  email_id: number
  role: string | null
  status: ApplicationStatus
  extracted_confidence: number
  // Joined from emails:
  subject: string
  snippet: string
  from_address: string
  from_name: string | null
  received_at: string
}

interface ScanStatus {
  syncState: SyncState
  activeRun: ScanRun | null
  progressPercent: number
  isRunning: boolean
  recentRuns: ScanRun[]
}
```

---

## Backend

### API Endpoints

#### Auth
| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/status` | Returns `{ authenticated: boolean }` |
| GET | `/auth/google` | Redirects to Google OAuth2 consent screen |
| GET | `/auth/callback` | Handles OAuth2 callback; saves tokens; redirects to frontend |

#### Companies
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/companies` | List all companies with interaction counts |
| GET | `/api/companies/:id` | Company detail + interactions + contacts + source lead |
| PATCH | `/api/companies/:id/status` | Manually set status + `status_override=1` |
| PATCH | `/api/companies/:id/lead` | Update source lead fields (role, contact, notes) |
| DELETE | `/api/companies/:id` | Delete company and all related data |
| POST | `/api/companies/extract-linkedin` | AI-extract profile info from LinkedIn URL |
| GET | `/api/companies/:id/contacts` | List company contacts |
| POST | `/api/companies/:id/contacts` | Create company contact |
| PATCH | `/api/companies/:id/contacts/:contactId` | Update company contact |
| DELETE | `/api/companies/:id/contacts/:contactId` | Delete company contact |

#### Leads
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/leads` | List all leads; optional `?status=` filter |
| GET | `/api/leads/:id` | Lead detail + moves + contacts |
| POST | `/api/leads` | Create new lead |
| PATCH | `/api/leads/:id` | Update lead fields |
| DELETE | `/api/leads/:id` | Delete lead and related data |
| POST | `/api/leads/extract-url` | AI-extract company + role from job URL |
| POST | `/api/leads/:id/convert` | Convert lead → company on dashboard |
| GET | `/api/leads/:id/contacts` | List lead contacts |
| POST | `/api/leads/:id/contacts` | Add lead contact |
| PATCH | `/api/leads/:id/contacts/:contactId` | Update lead contact |
| DELETE | `/api/leads/:id/contacts/:contactId` | Delete lead contact |
| GET | `/api/leads/:id/moves` | List lead interaction moves |
| POST | `/api/leads/:id/moves` | Log a new move |
| DELETE | `/api/leads/:id/moves/:moveId` | Delete a move |

#### Scan
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scan/status` | Current progress, active run, recent history |
| POST | `/api/scan/trigger` | Manually trigger scan (`{ type: 'historical' \| 'incremental' }`) |
| GET | `/api/scan/runs` | Paginated scan run history |

---

### Services

#### `gmail.service.ts`
- Manages OAuth2 client lifecycle (token load, refresh, save to `tokens.json`)
- `listMessages(query, pageToken)` → paginated Gmail message list
- `getFullMessage(id)` → full message payload with body
- `parseEmailBody(payload)` → decodes base64 body parts (plain text preference)
- `isAuthenticated()` → checks if tokens exist

#### `openai.service.ts`
- `classifyEmail(subject, snippet, from)` → Stage 1: `{ is_job_related, confidence }`
- `extractJobInfo(body)` → Stage 2: `{ companyName, companyDomain, jobRole, status, confidence }`
- `extractFromJobUrl(url)` → Fetches page content + AI-extracts company/role
- `extractLinkedInProfile(url)` → Parses LinkedIn profile for contact info

#### `scanner.service.ts`
- `runHistoricalScan()` → scans all emails since `SCAN_START_DATE` (paginated)
- `runIncrementalScan()` → scans emails since `last_scanned_after`
- `isCurrentlyRunning()` → flag preventing concurrent scans
- Pipeline per email: classify → extract → dedup company → create interaction → cache logo
- Crash recovery: marks stale `running` scan_run as `failed` on startup

#### `company.service.ts`
- `deduplicateCompany(domain, name)` → find-or-create company record
- Priority: exact domain match → AI domain match → fuzzy name match → create new
- `inferStatus(interactions)` → compute `current_status` from all interactions

#### `logo.service.ts`
- `resolveLogoUrl(domain)` → background logo resolution with `logo_cache` table
- Returns cached URL if resolved within last N days

---

### Utilities

#### `retry.ts`
```typescript
withRetry(fn, maxAttempts, baseDelayMs)  // Exponential backoff retry
withTimeout(fn, timeoutMs)               // Promise timeout wrapper
sleep(ms)                                // Promisified setTimeout
```

#### `logger.ts`
- Winston instance with two transports:
  - Console: colored, human-readable
  - File (`combined.log`): JSON, all levels
  - File (`error.log`): JSON, errors only
- Log level controlled by `LOG_LEVEL` env var (default: `info`)

---

## Database Schema

### Tables

#### `companies`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT NOT NULL | Company display name |
| `domain` | TEXT UNIQUE | Email domain; NULL if unknown |
| `logo_url` | TEXT | Resolved logo URL |
| `current_status` | TEXT | `applied` \| `rejected` \| `offer` |
| `status_override` | INTEGER | `1` = manually set, skip auto-update |
| `first_interaction_at` | TEXT | ISO timestamp |
| `last_interaction_at` | TEXT | ISO timestamp |

#### `emails`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `gmail_message_id` | TEXT UNIQUE | Gmail message ID |
| `thread_id` | TEXT | Gmail thread ID |
| `subject` | TEXT | |
| `snippet` | TEXT | Gmail auto-snippet |
| `from_address` | TEXT | Sender email |
| `received_at` | TEXT | ISO timestamp |
| `body_text` | TEXT | Decoded plain-text body |
| `raw_payload_json` | TEXT | Full Gmail payload JSON |
| `full_body_fetched` | INTEGER | `0`/`1` |
| `processed_flag` | INTEGER | `0`/`1` — processed through pipeline |
| `initial_is_job_related` | INTEGER | Stage 1 result |
| `initial_classification_confidence` | REAL | Stage 1 confidence |
| `is_job_related` | INTEGER | Final classification |
| `final_classification_confidence` | REAL | Final confidence |

#### `job_interactions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `company_id` | INTEGER FK | → `companies.id` |
| `email_id` | INTEGER FK UNIQUE | → `emails.id` |
| `role` | TEXT | Extracted job role |
| `status` | TEXT | `applied` \| `rejected` \| `offer` |
| `extracted_confidence` | REAL | AI confidence score |
| `raw_extraction_json` | TEXT | Full AI response JSON |

#### `scan_runs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `started_at` | TEXT | ISO timestamp |
| `finished_at` | TEXT | ISO timestamp or NULL if running |
| `status` | TEXT | `running` \| `completed` \| `failed` |
| `emails_scanned` | INTEGER | |
| `job_emails_detected` | INTEGER | |
| `scan_type` | TEXT | `historical` \| `incremental` |
| `error_message` | TEXT | Set on failure |

#### `sync_state` (single row, id=1)
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Always `1` |
| `last_scanned_after` | TEXT | ISO timestamp cursor for incremental scans |
| `history_scan_completed` | INTEGER | `0`/`1` |
| `last_page_token` | TEXT | Gmail pagination resume token |
| `total_estimated_emails` | INTEGER | Estimated total for progress % |
| `total_processed_emails` | INTEGER | Actual processed count |

#### `logo_cache`
| Column | Type | Notes |
|--------|------|-------|
| `domain` | TEXT PK | Company domain |
| `logo_url` | TEXT | Resolved URL |
| `resolved_at` | TEXT | ISO timestamp |

#### `leads`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `company_name` | TEXT NOT NULL | |
| `role` | TEXT | |
| `job_url` | TEXT | |
| `contact_person` | TEXT | |
| `contact_source` | TEXT | `linkedin` \| `email` \| `referral` \| `event` \| `other` |
| `date_first_contacted` | TEXT | |
| `status` | TEXT | `researching` \| `contacted` \| `waiting_response` \| `preparing_to_apply` \| `applied` \| `converted` |
| `notes` | TEXT | |
| `converted_company_id` | INTEGER FK | → `companies.id` if converted |
| `created_at` | TEXT | ISO timestamp |

#### `lead_moves`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `lead_id` | INTEGER FK | → `leads.id` |
| `date` | TEXT | |
| `description` | TEXT NOT NULL | |
| `person_contacted` | TEXT | |
| `link` | TEXT | |

#### `lead_contacts`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `lead_id` | INTEGER FK | → `leads.id` |
| `name` | TEXT NOT NULL | |
| `role` | TEXT | |
| `linkedin_url` | TEXT | |
| `status` | TEXT | `identified` \| `connected` \| `messaged` \| `replied` \| `referred` |
| `notes` | TEXT | |

#### `company_contacts`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `company_id` | INTEGER FK | → `companies.id` |
| `name` | TEXT NOT NULL | |
| `role` | TEXT | |
| `linkedin_url` | TEXT | |
| `notes` | TEXT | |

---

## Authentication

### Gmail OAuth2 Flow

```
User → GET /auth/google
  → Backend generates Google auth URL (scope: gmail.readonly, access: offline)
  → User consents on Google screen
  → Google → GET /auth/callback?code=...
  → Backend exchanges code for tokens
  → Tokens saved to backend/data/tokens.json
  → Redirect to frontend (/)
```

- **Token refresh:** OAuth2Client emits `tokens` event on refresh; tokens file updated automatically
- **Token check:** `gmailService.isAuthenticated()` reads tokens file existence
- **Scope:** `gmail.readonly` — read-only access to Gmail messages

---

## Email Processing Pipeline

### Overview

```
Gmail Inbox
    │
    ▼
[1] List messages (batches of 25, paginated)
    │
    ▼
[2] Skip if gmail_message_id already in DB
    │
    ▼
[3] Fetch full message from Gmail API
    │
    ▼
[4] Upsert to emails table
    │
    ▼
[5] Stage 1 Classification (snippet + subject + from)
    OpenAI gpt-4o-mini → { is_job_related, confidence }
    │
    ├── NOT job-related → mark processed_flag=1, skip
    │
    ▼
[6] Stage 2 Extraction (full body)
    OpenAI gpt-4o-mini → { companyName, domain, jobRole, status, confidence }
    │
    ▼
[7] Company Dedup
    1. Exact domain match in companies table?
    2. AI-extracted domain match?
    3. Fuzzy name match (LIKE)?
    4. Create new company
    │
    ▼
[8] Resolve logo in background (logo_cache)
    │
    ▼
[9] Create job_interaction record
    │
    ▼
[10] Update company.current_status (skip if status_override=1)
    │
    ▼
[11] Mark processed_flag=1
```

### Scan Modes

| Mode | Trigger | Scope |
|------|---------|-------|
| **Historical** | First run OR manual trigger | All emails since `SCAN_START_DATE` |
| **Incremental** | Daily at 06:00 (cron) OR manual trigger | Emails since `last_scanned_after` + newest 20 |

### Rate Limiting
- Gmail: batches of 25 with 400ms inter-batch delay
- OpenAI: 3× retry with exponential backoff, 15s timeout per call

### Non-Job Sender Filtering
Configured via `.env`:
```
NON_JOB_SENDERS=jobs-listings@linkedin.com,...
NON_JOB_SENDER_DOMAINS=linkedin.com,aiapply.co,...
```
These are filtered before Stage 1 classification to skip digest/automated emails.

---

## Configuration

### Backend `.env`
```bash
PORT=3001
BACKEND_PUBLIC_URL=http://localhost:3001
FRONTEND_ORIGIN=http://localhost:3000

# Google OAuth2
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback

# OpenAI
OPENAI_API_KEY=sk-...

# Scanning
SCAN_START_DATE=2026/01/01          # Earliest date to scan from
NON_JOB_SENDERS=...                  # Comma-separated email addresses to skip
NON_JOB_SENDER_DOMAINS=...           # Comma-separated domains to skip

# Logging
LOG_LEVEL=info                       # debug | info | warn | error
```

### Frontend `.env.local`
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## User Workflows

### Workflow 1: Automatic Inbox Scanning
1. Connect Gmail via OAuth (`/auth/google`)
2. Backend runs historical scan automatically
3. Daily cron at 06:00 runs incremental scan
4. Frontend polls `/api/scan/status` every 5s (when running) or 30s (idle)
5. Companies populate on Dashboard as emails are processed

### Workflow 2: Manual Lead Tracking
1. User finds a job → navigates to `/quick-lead`
2. Pastes job URL → AI extracts company + role
3. Saves as lead with status `researching`
4. On `/leads/:id`: adds contacts, logs outreach moves
5. When ready to apply: converts lead → company appears on dashboard

### Workflow 3: Company Status Override
1. On `/companies/:id`, use `StatusSelect` to manually set status
2. Sets `status_override=1` — future email scans won't auto-change status
3. Override can be cleared by selecting the same status again (implementation-dependent)

---

## Architecture Notes

### Idempotency Guarantees
- `emails.gmail_message_id` UNIQUE → no duplicate email storage
- `job_interactions.email_id` UNIQUE → each email processed exactly once
- `processed_flag=1` → skip re-processing on next scan
- `companies.domain` UNIQUE → no duplicate company per domain

### Crash Recovery
- On startup: any stale `status='running'` scan_run is marked `failed`
- Scan resumes from `last_page_token` stored in `sync_state`
- Already-processed emails skipped via `processed_flag`

### Single-User Design
- No auth layer on API routes (localhost only)
- SQLite — no connection pooling needed
- `sync_state` is a single-row table (always `id=1`)
- Token file stored locally, not in DB

### Dark Theme
- Tailwind configured with custom `bg-surface`, `text-zinc-100` tokens
- All UI components use dark palette by default
