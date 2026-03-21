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
  status_override: number;
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
  body_text: string | null;
  raw_payload_json: string | null;
  initial_is_job_related: number | null;
  initial_classification_confidence: number | null;
  is_job_related: number | null;
  final_classification_confidence: number | null;
  full_body_fetched: number;
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
const SCHEMA_PATH_CANDIDATES = [
  path.join(__dirname, 'schema.sql'),
  path.join(__dirname, '../../src/db/schema.sql'),
  path.join(process.cwd(), 'dist/db/schema.sql'),
  path.join(process.cwd(), 'src/db/schema.sql'),
];

let _db: DatabaseSync | null = null;

function resolveSchemaPath(): string {
  for (const candidate of SCHEMA_PATH_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Database schema.sql not found. Checked: ${SCHEMA_PATH_CANDIDATES.join(', ')}`
  );
}

export function getDb(): DatabaseSync {
  if (!_db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    _db = new DatabaseSync(DB_PATH);
    _db.exec('PRAGMA journal_mode = WAL');
    _db.exec('PRAGMA synchronous = NORMAL');
    _db.exec('PRAGMA foreign_keys = ON');

    // node:sqlite's exec() handles multi-statement SQL natively
    const schemaPath = resolveSchemaPath();
    const schema = fs.readFileSync(schemaPath, 'utf8');
    _db.exec(schema);
    ensureCompanyColumns(_db);
    ensureEmailColumns(_db);
    ensureCanonicalStatuses(_db);

    logger.info('Database initialized', { path: DB_PATH });
  }
  return _db;
}

function ensureCompanyColumns(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(companies)`).all() as Array<{ name: string }>;
  const hasStatusOverride = cols.some((c) => c.name === 'status_override');
  if (!hasStatusOverride) {
    db.exec(`ALTER TABLE companies ADD COLUMN status_override INTEGER NOT NULL DEFAULT 0`);
  }
}

function ensureEmailColumns(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(emails)`).all() as Array<{ name: string }>;
  const has = (name: string): boolean => cols.some((c) => c.name === name);

  if (!has('body_text')) {
    db.exec(`ALTER TABLE emails ADD COLUMN body_text TEXT`);
  }
  if (!has('initial_is_job_related')) {
    db.exec(`ALTER TABLE emails ADD COLUMN initial_is_job_related INTEGER`);
  }
  if (!has('initial_classification_confidence')) {
    db.exec(`ALTER TABLE emails ADD COLUMN initial_classification_confidence REAL`);
  }
  if (!has('final_classification_confidence')) {
    db.exec(`ALTER TABLE emails ADD COLUMN final_classification_confidence REAL`);
  }
  if (!has('full_body_fetched')) {
    db.exec(`ALTER TABLE emails ADD COLUMN full_body_fetched INTEGER NOT NULL DEFAULT 0`);
  }
}

function ensureCanonicalStatuses(db: DatabaseSync): void {
  db.exec(`
    UPDATE job_interactions
       SET status = CASE
         WHEN lower(status) = 'offer' THEN 'offer'
         WHEN lower(status) IN ('rejected', 'rejection') THEN 'rejected'
         ELSE 'applied'
       END;

    UPDATE companies
       SET current_status = CASE
         WHEN lower(current_status) = 'offer' THEN 'offer'
         WHEN lower(current_status) IN ('rejected', 'rejection') THEN 'rejected'
         ELSE 'applied'
       END;
  `);
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
  syncAllCompanyStatuses();
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
  syncCompanyStatus(id);
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
      current_status: data.current_status ?? 'applied',
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
  // Only update if the new interaction is at least as recent as what is stored.
  // This prevents an older email processed late from overwriting a newer status.
  getDb()
    .prepare(
      `UPDATE companies
          SET current_status = CASE WHEN status_override = 0 THEN @status ELSE current_status END,
              last_interaction_at = @last_interaction_at,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = @id
          AND @last_interaction_at >= COALESCE(last_interaction_at, '')`
    )
    .run({ id, status, last_interaction_at: lastInteractionAt });
}

export function updateCompanyStatusManual(id: number, status: string): void {
  getDb()
    .prepare(
      `UPDATE companies
          SET current_status = @status,
              status_override = 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = @id`
    )
    .run({ id, status });
}

function syncCompanyStatus(companyId: number): void {
  const latest = getDb()
    .prepare(
      `SELECT ji.status AS status,
              COALESCE(e.received_at, ji.created_at) AS interaction_at
         FROM job_interactions ji
         JOIN emails e ON e.id = ji.email_id
        WHERE ji.company_id = ?
        ORDER BY COALESCE(e.received_at, ji.created_at) DESC
        LIMIT 1`
    )
    .get(companyId) as { status?: string; interaction_at?: string } | undefined;

  if (!latest?.status || !latest.interaction_at) return;

  getDb()
    .prepare(
      `UPDATE companies
          SET current_status = CASE WHEN status_override = 0 THEN @status ELSE current_status END,
              last_interaction_at = @interaction_at,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = @id
          AND @interaction_at >= COALESCE(last_interaction_at, '')`
    )
    .run({ id: companyId, status: latest.status, interaction_at: latest.interaction_at });
}

function syncAllCompanyStatuses(): void {
  getDb().exec(
    `UPDATE companies
        SET current_status = CASE
              WHEN status_override = 0 THEN (
                SELECT ji.status
                  FROM job_interactions ji
                  JOIN emails e ON e.id = ji.email_id
                 WHERE ji.company_id = companies.id
                 ORDER BY COALESCE(e.received_at, ji.created_at) DESC
                 LIMIT 1
              )
              ELSE current_status
            END,
            last_interaction_at = (
              SELECT COALESCE(e.received_at, ji.created_at)
                FROM job_interactions ji
                JOIN emails e ON e.id = ji.email_id
               WHERE ji.company_id = companies.id
               ORDER BY COALESCE(e.received_at, ji.created_at) DESC
               LIMIT 1
            ),
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE EXISTS (
              SELECT 1
                FROM job_interactions ji
               WHERE ji.company_id = companies.id
            )`
  );
}

export function deleteCompany(id: number): boolean {
  const result = getDb()
    .prepare(`DELETE FROM companies WHERE id = ?`)
    .run(id);
  return (result as { changes: number }).changes > 0;
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

export function getEmailByGmailMessageId(gmailMessageId: string): Email | undefined {
  const r = getDb()
    .prepare(`SELECT * FROM emails WHERE gmail_message_id = ?`)
    .get(gmailMessageId);
  return r ? row<Email>(r) : undefined;
}

export function upsertEmail(data: {
  gmail_message_id: string;
  thread_id?: string | null;
  subject?: string | null;
  snippet?: string | null;
  from_address?: string | null;
  from_name?: string | null;
  received_at?: string | null;
  body_text?: string | null;
  raw_payload_json?: string | null;
  full_body_fetched?: number;
}): Email {
  const result = getDb()
    .prepare(
      `INSERT INTO emails
         (gmail_message_id, thread_id, subject, snippet, from_address, from_name, received_at, body_text, raw_payload_json, full_body_fetched)
       VALUES
         (@gmail_message_id, @thread_id, @subject, @snippet, @from_address, @from_name, @received_at, @body_text, @raw_payload_json, @full_body_fetched)
       ON CONFLICT(gmail_message_id) DO UPDATE SET
         thread_id        = COALESCE(excluded.thread_id, emails.thread_id),
         subject          = COALESCE(excluded.subject, emails.subject),
         snippet          = COALESCE(excluded.snippet, emails.snippet),
         from_address     = COALESCE(excluded.from_address, emails.from_address),
         from_name        = COALESCE(excluded.from_name, emails.from_name),
         received_at      = COALESCE(excluded.received_at, emails.received_at),
         body_text        = COALESCE(excluded.body_text, emails.body_text),
         raw_payload_json = CASE
                              WHEN excluded.full_body_fetched = 1 THEN excluded.raw_payload_json
                              WHEN emails.raw_payload_json IS NULL THEN excluded.raw_payload_json
                              ELSE emails.raw_payload_json
                            END,
         full_body_fetched = MAX(emails.full_body_fetched, excluded.full_body_fetched)
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
      body_text: data.body_text ?? null,
      raw_payload_json: data.raw_payload_json ?? null,
      full_body_fetched: data.full_body_fetched ?? 0,
    });
  return row<Email>(result);
}

export function markEmailInitialClassification(
  id: number,
  isJobRelated: boolean,
  confidence: number
): void {
  getDb()
    .prepare(
      `UPDATE emails
          SET initial_is_job_related = @initial_is_job_related,
              initial_classification_confidence = @initial_classification_confidence
        WHERE id = @id`
    )
    .run({
      id,
      initial_is_job_related: isJobRelated ? 1 : 0,
      initial_classification_confidence: confidence,
    });
}

export function markEmailFinalClassification(
  id: number,
  isJobRelated: boolean,
  confidence: number
): void {
  getDb()
    .prepare(
      `UPDATE emails
          SET is_job_related = @is_job_related,
              final_classification_confidence = @final_classification_confidence
        WHERE id = @id`
    )
    .run({
      id,
      is_job_related: isJobRelated ? 1 : 0,
      final_classification_confidence: confidence,
    });
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

export function listPendingEmailMessageIds(limit = 500): string[] {
  const rows = getDb()
    .prepare(
      `SELECT gmail_message_id
         FROM emails
        WHERE processed_flag = 0
        ORDER BY created_at ASC
        LIMIT ?`
    )
    .all(limit) as Array<{ gmail_message_id: string }>;

  return rows.map((r) => r.gmail_message_id);
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

export function jobInteractionExistsForEmail(emailId: number): boolean {
  const r = getDb()
    .prepare(`SELECT 1 AS ok FROM job_interactions WHERE email_id = ? LIMIT 1`)
    .get(emailId) as { ok: number } | undefined;
  return !!r;
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

// ─── Leads ────────────────────────────────────────────────────────────────────

export interface Lead {
  id: number;
  company_name: string;
  role: string | null;
  contact_person: string | null;
  contact_source: string | null;
  date_first_contacted: string | null;
  status: string;
  notes: string | null;
  converted_company_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface LeadWithMoveCount extends Lead {
  move_count: number;
}

export interface LeadMove {
  id: number;
  lead_id: number;
  date: string;
  description: string;
  person_contacted: string | null;
  link: string | null;
  created_at: string;
}

export function listLeads(status?: string): LeadWithMoveCount[] {
  const db = getDb();
  if (status && status !== 'all') {
    return rows<LeadWithMoveCount>(
      db
        .prepare(
          `SELECT l.*, COUNT(lm.id) AS move_count
             FROM leads l
             LEFT JOIN lead_moves lm ON lm.lead_id = l.id
            WHERE l.status = ?
            GROUP BY l.id
            ORDER BY l.updated_at DESC`
        )
        .all(status)
    );
  }
  return rows<LeadWithMoveCount>(
    db
      .prepare(
        `SELECT l.*, COUNT(lm.id) AS move_count
           FROM leads l
           LEFT JOIN lead_moves lm ON lm.lead_id = l.id
          GROUP BY l.id
          ORDER BY l.updated_at DESC`
      )
      .all()
  );
}

export function getLeadById(id: number): Lead | undefined {
  const r = getDb().prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
  return r ? row<Lead>(r) : undefined;
}

export function createLead(data: {
  company_name: string;
  role?: string | null;
  contact_person?: string | null;
  contact_source?: string | null;
  date_first_contacted?: string | null;
  status?: string;
  notes?: string | null;
}): Lead {
  const result = getDb()
    .prepare(
      `INSERT INTO leads (company_name, role, contact_person, contact_source, date_first_contacted, status, notes)
       VALUES (@company_name, @role, @contact_person, @contact_source, @date_first_contacted, @status, @notes)
       RETURNING *`
    )
    .get({
      company_name: data.company_name,
      role: data.role ?? null,
      contact_person: data.contact_person ?? null,
      contact_source: data.contact_source ?? null,
      date_first_contacted: data.date_first_contacted ?? null,
      status: data.status ?? 'researching',
      notes: data.notes ?? null,
    });
  return row<Lead>(result);
}

export function updateLead(
  id: number,
  data: Partial<Pick<Lead, 'company_name' | 'role' | 'contact_person' | 'contact_source' | 'date_first_contacted' | 'status' | 'notes'>>
): Lead | undefined {
  const fields: string[] = [`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`];
  const params: Record<string, unknown> = { id };

  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = @${key}`);
    params[key] = value;
  }

  if (fields.length === 1) return getLeadById(id); // only updated_at, nothing changed

  getDb()
    .prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = @id`)
    .run(params);

  return getLeadById(id);
}

export function deleteLead(id: number): boolean {
  const result = getDb().prepare(`DELETE FROM leads WHERE id = ?`).run(id);
  return (result as { changes: number }).changes > 0;
}

export function convertLead(leadId: number, companyId: number): void {
  getDb()
    .prepare(
      `UPDATE leads
          SET status = 'converted',
              converted_company_id = @company_id,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = @id`
    )
    .run({ id: leadId, company_id: companyId });
}

// ─── Lead Moves ───────────────────────────────────────────────────────────────

export function listLeadMoves(leadId: number): LeadMove[] {
  return rows<LeadMove>(
    getDb()
      .prepare(`SELECT * FROM lead_moves WHERE lead_id = ? ORDER BY date DESC, created_at DESC`)
      .all(leadId)
  );
}

export function createLeadMove(data: {
  lead_id: number;
  date: string;
  description: string;
  person_contacted?: string | null;
  link?: string | null;
}): LeadMove {
  const result = getDb()
    .prepare(
      `INSERT INTO lead_moves (lead_id, date, description, person_contacted, link)
       VALUES (@lead_id, @date, @description, @person_contacted, @link)
       RETURNING *`
    )
    .get({
      lead_id: data.lead_id,
      date: data.date,
      description: data.description,
      person_contacted: data.person_contacted ?? null,
      link: data.link ?? null,
    });
  return row<LeadMove>(result);
}

export function deleteLeadMove(id: number): boolean {
  const result = getDb().prepare(`DELETE FROM lead_moves WHERE id = ?`).run(id);
  return (result as { changes: number }).changes > 0;
}
