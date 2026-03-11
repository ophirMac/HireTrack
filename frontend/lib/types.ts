// ─── Domain Types — mirrors backend DB types ──────────────────────────────────

export type ApplicationStatus =
  | 'applied'
  | 'confirmation'
  | 'recruiter_reachout'
  | 'interview'
  | 'assignment'
  | 'rejection'
  | 'offer'
  | 'unknown';

export interface Company {
  id: number;
  name: string;
  domain: string | null;
  logo_url: string | null;
  current_status: ApplicationStatus;
  first_interaction_at: string | null;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
  interaction_count: number;
}

export interface JobInteraction {
  id: number;
  company_id: number;
  email_id: number;
  role: string | null;
  status: ApplicationStatus;
  extracted_confidence: number | null;
  raw_extraction_json: string | null;
  created_at: string;
  // joined from emails
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
  status: 'running' | 'completed' | 'failed';
  emails_scanned: number;
  job_emails_detected: number;
  scan_type: 'historical' | 'incremental';
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

export interface ScanStatus {
  syncState: SyncState;
  activeRun: ScanRun | null;
  progressPercent: number | null;
  isRunning: boolean;
  recentRuns: ScanRun[];
}

// ─── API Response types ───────────────────────────────────────────────────────

export interface CompaniesResponse {
  companies: Company[];
}

export interface CompanyDetailResponse {
  company: Company;
  interactions: JobInteraction[];
}
