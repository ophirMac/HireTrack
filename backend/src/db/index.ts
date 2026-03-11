// Using Node.js built-in SQLite (node:sqlite) — no native compilation required.
// Available since Node.js v22.5.0.
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Company {
  id: number;
  name: string;
  domain: string | null;
  logo_url: string | null;
  current_status: string;
  first_interaction_at: string | null;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyWithStats extends Company {
  interaction_count: number;
}

export interface Email {
  id: number;
  gmail_message_id: string;
  thread_id: string | null;
  subject: string | null;
  snippet: string | null;
  from_address: string | null;
  from_name: string | null;
  received_at: string | null;
  raw_payload_json: string | null;
  is_job_related: number | null;
  processed_flag: number;
  created_at: string;
}

export interface JobInteraction {
  id: number;
  company_id: number;
  email_id: number;
  role: string | null;
  status: string;
  extracted_confidence: number | null;
  raw_extraction_json: string | null;
  created_at: string;
}

export interface JobInteractionWithEmail extends JobInteraction {
  subject: string | null;
  snippet: string | null;
  from_address: string | null;
  from_name: string | null;
  received_at: string | null;
}

export interface ScanRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  emails_scanned: number;
  job_emails_detected: number;
  scan_type: string;
  error_message: string | null;
  created_at: string;
}

export interface SyncState {
  id: number;
  last_scanned_after: string | null;
  history_scan_completed: number;
  last_page_token: string | null;
  total_estimated_emails: number;
  total_processed_emails: number;
  updated_at: string;
}

// ─── DB Singleton ─────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'hiretrack.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!_db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    _db = new DatabaseSync(DB_PATH);
    _db.exec('PRAGMA journal_mode = WAL');
    _db.exec('PRAGMA synchronous = NORMAL');
    _db.exec('PRAGMA foreign_keys = ON');

    // node:sqlite's exec() handles multi-statement SQL natively
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    _db.exec(schema);

    logger.info('Database initialized', { path: DB_PATH });
  }
  return _db;
}

/** Convert null-prototype objects returned by node:sqlite to plain objects */
function row<T>(obj: unknown): T {
  return Object.assign({}, obj) as T;
}

function rows<T>(arr: unknown[]): T[] {
  return arr.map((o) => Object.assign({}, o) as T);
}

// ─── Companies ────────────────────────────────────────────────────────────────

export function listCompanies(): CompanyWithStats[] {
  return rows<CompanyWithStats>(
    getDb()
      .prepare(
        `SELECT c.*,
                COUNT(ji.id) AS interaction_count
           FROM companies c
           LEFT JOIN job_interactions ji ON ji.company_id = c.id
          GROUP BY c.id
          ORDER BY c.last_interaction_at DESC`
      )
      .all()
  );
}

export function getCompanyById(id: number): Company | undefined {
  const r = getDb().prepare(`SELECT * FROM companies WHERE id = ?`).get(id);
  return r ? row<Company>(r) : undefined;
}

export function findCompanyByDomain(domain: string): Company | undefined {
  const r = getDb()
    .prepare(`SELECT * FROM companies WHERE lower(domain) = lower(?)`)
    .get(domain);
  return r ? row<Company>(r) : undefined;
}

export function findCompanyByName(name: string): Company | undefined {
  const exact = getDb()
    .prepare(`SELECT * FROM companies WHERE lower(name) = lower(?)`)
    .get(name);
  if (exact) return row<Company>(exact);
  const like = getDb()
    .prepare(`SELECT * FROM companies WHERE lower(name) LIKE lower(?) LIMIT 1`)
    .get(`%${name}%`);
  return like ? row<Company>(like) : undefined;
}

export function createCompany(data: {
  name: string;
  domain?: string | null;
  logo_url?: string | null;
  current_status?: string;
  first_interaction_at?: string;
  last_interaction_at?: string;
}): Company {
  const result = getDb()
    .prepare(
      `INSERT INTO companies (name, domain, logo_url, current_status, first_interaction_at, last_interaction_at)
       VALUES (@name, @domain, @logo_url, @current_status, @first_interaction_at, @last_interaction_at)
       RETURNING *`
    )
    .get({
      name: data.name,
      domain: data.domain ?? null,
      logo_url: data.logo_url ?? null,
      current_status: data.current_status ?? 'unknown',
      first_interaction_at: data.first_interaction_at ?? null,
      last_interaction_at: data.last_interaction_at ?? null,
    });
  return row<Company>(result);
}

export function updateCompanyStatus(
  id: number,
  status: string,
  lastInteractionAt: string
): void {
  getDb()
    .prepare(
      `UPDATE companies
          SET current_status = @status,
              last_interaction_at = @last_interaction_at,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = @id`
    )
    .run({ id, status, last_interaction_at: lastInteractionAt });
}

export function updateCompanyLogo(id: number, logoUrl: string): void {
  getDb()
    .prepare(
      `UPDATE companies
          SET logo_url = @logo_url,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = @id`
    )
    .run({ id, logo_url: logoUrl });
}

// ─── Emails ───────────────────────────────────────────────────────────────────

export function emailProcessed(gmailMessageId: string): boolean {
  const r = getDb()
    .prepare(`SELECT processed_flag FROM emails WHERE gmail_message_id = ?`)
    .get(gmailMessageId) as { processed_flag: number } | undefined;
  return !!r && r.processed_flag === 1;
}

export function upsertEmail(data: {
  gmail_message_id: string;
  thread_id?: string | null;
  subject?: string | null;
  snippet?: string | null;
  from_address?: string | null;
  from_name?: string | null;
  received_at?: string | null;
  raw_payload_json?: string | null;
}): Email {
  const result = getDb()
    .prepare(
      `INSERT INTO emails
         (gmail_message_id, thread_id, subject, snippet, from_address, from_name, received_at, raw_payload_json)
       VALUES
         (@gmail_message_id, @thread_id, @subject, @snippet, @from_address, @from_name, @received_at, @raw_payload_json)
       ON CONFLICT(gmail_message_id) DO UPDATE SET
         thread_id        = excluded.thread_id,
         subject          = excluded.subject,
         snippet          = excluded.snippet,
         from_address     = excluded.from_address,
         from_name        = excluded.from_name,
         received_at      = excluded.received_at,
         raw_payload_json = excluded.raw_payload_json
       RETURNING *`
    )
    .get({
      gmail_message_id: data.gmail_message_id,
      thread_id: data.thread_id ?? null,
      subject: data.subject ?? null,
      snippet: data.snippet ?? null,
      from_address: data.from_address ?? null,
      from_name: data.from_name ?? null,
      received_at: data.received_at ?? null,
      raw_payload_json: data.raw_payload_json ?? null,
    });
  return row<Email>(result);
}

export function markEmailClassified(
  id: number,
  isJobRelated: boolean
): void {
  getDb()
    .prepare(`UPDATE emails SET is_job_related = ? WHERE id = ?`)
    .run(isJobRelated ? 1 : 0, id);
}

export function markEmailProcessed(id: number): void {
  getDb()
    .prepare(`UPDATE emails SET processed_flag = 1 WHERE id = ?`)
    .run(id);
}

export function getEmailById(id: number): Email | undefined {
  const r = getDb().prepare(`SELECT * FROM emails WHERE id = ?`).get(id);
  return r ? row<Email>(r) : undefined;
}

// ─── Job Interactions ─────────────────────────────────────────────────────────

export function createJobInteraction(data: {
  company_id: number;
  email_id: number;
  role?: string | null;
  status: string;
  extracted_confidence?: number | null;
  raw_extraction_json?: string | null;
}): JobInteraction {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO job_interactions
         (company_id, email_id, role, status, extracted_confidence, raw_extraction_json)
       VALUES
         (@company_id, @email_id, @role, @status, @extracted_confidence, @raw_extraction_json)
       RETURNING *`
    )
    .get({
      company_id: data.company_id,
      email_id: data.email_id,
      role: data.role ?? null,
      status: data.status,
      extracted_confidence: data.extracted_confidence ?? null,
      raw_extraction_json: data.raw_extraction_json ?? null,
    });
  return row<JobInteraction>(result);
}

export function getInteractionsByCompany(
  companyId: number
): JobInteractionWithEmail[] {
  return rows<JobInteractionWithEmail>(
    getDb()
      .prepare(
        `SELECT ji.*,
                e.subject, e.snippet, e.from_address, e.from_name, e.received_at
           FROM job_interactions ji
           JOIN emails e ON e.id = ji.email_id
          WHERE ji.company_id = ?
          ORDER BY COALESCE(e.received_at, ji.created_at) DESC`
      )
      .all(companyId)
  );
}

// ─── Scan Runs ────────────────────────────────────────────────────────────────

export function createScanRun(scanType: 'historical' | 'incremental'): ScanRun {
  const result = getDb()
    .prepare(
      `INSERT INTO scan_runs (started_at, scan_type, status)
       VALUES (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?, 'running')
       RETURNING *`
    )
    .get(scanType);
  return row<ScanRun>(result);
}

export function updateScanRun(
  id: number,
  data: {
    status?: string;
    emails_scanned?: number;
    job_emails_detected?: number;
    error_message?: string | null;
    finished_at?: string;
  }
): void {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id };

  if (data.status !== undefined) {
    fields.push('status = @status');
    params.status = data.status;
  }
  if (data.emails_scanned !== undefined) {
    fields.push('emails_scanned = @emails_scanned');
    params.emails_scanned = data.emails_scanned;
  }
  if (data.job_emails_detected !== undefined) {
    fields.push('job_emails_detected = @job_emails_detected');
    params.job_emails_detected = data.job_emails_detected;
  }
  if (data.error_message !== undefined) {
    fields.push('error_message = @error_message');
    params.error_message = data.error_message;
  }
  if (data.finished_at !== undefined) {
    fields.push('finished_at = @finished_at');
    params.finished_at = data.finished_at;
  }

  if (fields.length === 0) return;
  getDb()
    .prepare(`UPDATE scan_runs SET ${fields.join(', ')} WHERE id = @id`)
    .run(params);
}

export function getActiveScanRun(): ScanRun | undefined {
  const r = getDb()
    .prepare(`SELECT * FROM scan_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`)
    .get();
  return r ? row<ScanRun>(r) : undefined;
}

export function listScanRuns(limit = 20): ScanRun[] {
  return rows<ScanRun>(
    getDb()
      .prepare(`SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?`)
      .all(limit)
  );
}

// ─── Sync State ───────────────────────────────────────────────────────────────

export function getSyncState(): SyncState {
  const r = getDb().prepare(`SELECT * FROM sync_state WHERE id = 1`).get();
  return row<SyncState>(r);
}

export function updateSyncState(
  data: Partial<Omit<SyncState, 'id' | 'updated_at'>>
): void {
  const fields: string[] = [
    `updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
  ];
  const params: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = @${key}`);
    params[key] = value;
  }

  getDb()
    .prepare(`UPDATE sync_state SET ${fields.join(', ')} WHERE id = 1`)
    .run(params);
}

// ─── Logo Cache ───────────────────────────────────────────────────────────────

export function getLogoCache(domain: string): string | null {
  const r = getDb()
    .prepare(`SELECT logo_url FROM logo_cache WHERE domain = ?`)
    .get(domain) as { logo_url: string } | undefined;
  return r?.logo_url ?? null;
}

export function setLogoCache(domain: string, logoUrl: string | null): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO logo_cache (domain, logo_url, resolved_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`
    )
    .run(domain, logoUrl);
}
