-- HireTrack Database Schema
-- SQLite with WAL mode for concurrent read performance

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- companies
-- One record per unique employer. Domain is the primary deduplication key.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT    NOT NULL,
  domain                TEXT,
  logo_url              TEXT,
  current_status        TEXT    NOT NULL DEFAULT 'applied',
  status_override       INTEGER NOT NULL DEFAULT 0,
  first_interaction_at  TEXT,
  last_interaction_at   TEXT,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- domain is the primary dedup key; null domains allowed (may merge later)
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_domain
  ON companies(domain) WHERE domain IS NOT NULL AND domain != '';

CREATE INDEX IF NOT EXISTS idx_companies_last_interaction
  ON companies(last_interaction_at DESC);

CREATE INDEX IF NOT EXISTS idx_companies_name
  ON companies(name COLLATE NOCASE);

-- ─────────────────────────────────────────────────────────────────────────────
-- emails
-- Raw inbox messages. Stored once, processed once.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emails (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_message_id    TEXT    NOT NULL UNIQUE,
  thread_id           TEXT,
  subject             TEXT,
  snippet             TEXT,
  from_address        TEXT,
  from_name           TEXT,
  received_at         TEXT,
  body_text           TEXT,
  raw_payload_json    TEXT,
  initial_is_job_related             INTEGER, -- snippet-only stage decision
  initial_classification_confidence  REAL,    -- snippet-only confidence
  is_job_related      INTEGER,              -- 1 yes, 0 no, NULL unclassified
  final_classification_confidence    REAL,    -- authoritative stage confidence
  full_body_fetched   INTEGER NOT NULL DEFAULT 0, -- 0 not fetched, 1 fetched
  processed_flag      INTEGER NOT NULL DEFAULT 0,  -- 0 pending, 1 done
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_gmail_id   ON emails(gmail_message_id);
CREATE INDEX        IF NOT EXISTS idx_emails_received   ON emails(received_at DESC);
CREATE INDEX        IF NOT EXISTS idx_emails_processed  ON emails(processed_flag);
CREATE INDEX        IF NOT EXISTS idx_emails_thread     ON emails(thread_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- job_interactions
-- One row per email that was classified as job-related and fully extracted.
-- email_id UNIQUE ensures exactly-once extraction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_interactions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email_id              INTEGER NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
  role                  TEXT,
  status                TEXT    NOT NULL DEFAULT 'applied',
  extracted_confidence  REAL,
  raw_extraction_json   TEXT,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_interactions_company ON job_interactions(company_id);
CREATE INDEX IF NOT EXISTS idx_interactions_created ON job_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_status  ON job_interactions(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- scan_runs
-- Append-only audit log of every scan execution.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at          TEXT    NOT NULL,
  finished_at         TEXT,
  status              TEXT    NOT NULL DEFAULT 'running',   -- running/completed/failed
  emails_scanned      INTEGER NOT NULL DEFAULT 0,
  job_emails_detected INTEGER NOT NULL DEFAULT 0,
  scan_type           TEXT    NOT NULL DEFAULT 'incremental', -- historical/incremental
  error_message       TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_runs_status  ON scan_runs(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- leads
-- Manual pre-application tracking records. Each row is a potential opportunity
-- the user is nurturing before formally applying.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name          TEXT    NOT NULL,
  role                  TEXT,
  contact_person        TEXT,
  contact_source        TEXT,                        -- linkedin/email/referral/event/other
  date_first_contacted  TEXT,                        -- ISO date string
  status                TEXT    NOT NULL DEFAULT 'researching',
  notes                 TEXT,
  converted_company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_status       ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_company_name ON leads(company_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leads_updated      ON leads(updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- lead_moves
-- Timeline of interaction actions per lead.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_moves (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id           INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  date              TEXT    NOT NULL,
  description       TEXT    NOT NULL,
  person_contacted  TEXT,
  link              TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_moves_lead_id ON lead_moves(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_moves_date    ON lead_moves(date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_state
-- Single-row control table. Stores scan cursor for safe resumption.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_state (
  id                      INTEGER PRIMARY KEY DEFAULT 1 CHECK(id = 1),
  last_scanned_after      TEXT,          -- ISO datetime of last successful scan end
  history_scan_completed  INTEGER NOT NULL DEFAULT 0,
  last_page_token         TEXT,          -- Gmail pageToken for scan resumption after crash
  total_estimated_emails  INTEGER NOT NULL DEFAULT 0,
  total_processed_emails  INTEGER NOT NULL DEFAULT 0,
  updated_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Seed initial row
INSERT OR IGNORE INTO sync_state (id) VALUES (1);

-- ─────────────────────────────────────────────────────────────────────────────
-- logo_cache
-- Persist resolved logo URLs to avoid repeated API calls.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logo_cache (
  domain      TEXT PRIMARY KEY,
  logo_url    TEXT,
  resolved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
